// @effect-diagnostics nodeBuiltinImport:off - Effect has no incremental digest.
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstallState,
} from "@t3tools/contracts";
import { MINIMUM_OPENCODE_VERSION } from "@t3tools/provider-opencode/server";
import { cliArchiveTarCommand } from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import { VERSION_PROBE_TIMEOUT_MS } from "@t3tools/provider-core/server/snapshotProbe";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath, resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeCrypto from "node:crypto";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";

/*
 * UpComputer: a new user's first agent. The app downloads a pinned OpenCode
 * release, whose free Zen models answer without an account, so the first
 * thread needs no terminal and no sign-in. The pin moves with app releases
 * only: an upstream release can never change what first launch installs.
 */

const DRIVER = ProviderDriverKind.make("opencode");
const DEFAULT_BINARY = "opencode";
const STAGING_STALE_AFTER_MS = 24 * 60 * 60_000;
// One VM download stalled for minutes mid-body, so a quiet connection fails
// with Retry instead of an endless progress bar.
const DOWNLOAD_STALL_TIMEOUT = "30 seconds";
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u));
const ActiveRelease = Schema.Struct({ version: Version });
const InstalledRelease = Schema.Struct({ version: Version, sha256: Schema.String });
const decodeVersion = Schema.decodeUnknownEffect(Version);
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(InstalledRelease));
const encodeActive = Schema.encodeEffect(Schema.fromJsonString(ActiveRelease));

export interface OpenCodeReleaseAsset {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  readonly archiveBytes: number;
}

const RELEASE_BASE_URL = "https://github.com/sst/opencode/releases/download/v1.19.3";
// x64 takes the `baseline` builds: the default ones need AVX2, which Rosetta
// and some older or virtual CPUs lack.
const RELEASES: Readonly<Record<string, OpenCodeReleaseAsset>> = {
  "darwin-arm64": {
    version: "1.19.3",
    url: `${RELEASE_BASE_URL}/opencode-darwin-arm64.zip`,
    sha256: "c2d0fecd27acf6e08be02c1f5d384614d07495587766bcc4a6bff3971749bb64",
    archiveBytes: 45587801,
  },
  "darwin-x64": {
    version: "1.19.3",
    url: `${RELEASE_BASE_URL}/opencode-darwin-x64-baseline.zip`,
    sha256: "03f8c32f81a2c35429afedfb8f63978af32329febcebf800d52486f6ba568151",
    archiveBytes: 49218661,
  },
  "linux-arm64": {
    version: "1.19.3",
    url: `${RELEASE_BASE_URL}/opencode-linux-arm64.tar.gz`,
    sha256: "7900818a6a98881edbbadab4b7525940eff3b9750040c200481f9f56cacee405",
    archiveBytes: 60519745,
  },
  "linux-x64": {
    version: "1.19.3",
    url: `${RELEASE_BASE_URL}/opencode-linux-x64-baseline.tar.gz`,
    sha256: "531cff2441129c30f0edd5878af494108ad07f5feb46d7ee29a2a5b830a5765d",
    archiveBytes: 60716645,
  },
  "win32-arm64": {
    version: "1.19.3",
    url: `${RELEASE_BASE_URL}/opencode-windows-arm64.zip`,
    sha256: "c1b9daf18c97564b2d171703279621f7edc3613e70750d796ef78db87257ad89",
    archiveBytes: 60695316,
  },
  "win32-x64": {
    version: "1.19.3",
    url: `${RELEASE_BASE_URL}/opencode-windows-x64-baseline.zip`,
    sha256: "0d59113484bfe8d6dc146fc981f5c33faa8318303c183711b7a9387060b289e8",
    archiveBytes: 62204138,
  },
};
export const resolveOpenCodeReleaseAsset = (platform: NodeJS.Platform, arch: string) =>
  RELEASES[`${platform}-${arch}`] ?? null;

export class OpenCodeInstallationError extends Schema.TaggedError<OpenCodeInstallationError>()(
  "OpenCodeInstallationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return this.detail;
  }
}
const isInstallationError = Schema.is(OpenCodeInstallationError);
const installationError = (operation: string, detail: string, cause?: unknown) =>
  new OpenCodeInstallationError({ operation, detail, ...(cause === undefined ? {} : { cause }) });
const wrapFailure = (operation: string, detail: string) => (cause: unknown) =>
  isInstallationError(cause) ? cause : installationError(operation, detail, cause);

interface OpenCodeExecutable {
  readonly executablePath: string;
  readonly source: "managed" | "local";
  readonly version: string;
}

interface OpenCodeInstallationService {
  readonly managedDirectory: string;
  readonly start: Effect.Effect<ProviderInstallState, OpenCodeInstallationError>;
  readonly cancel: (
    operationId: string,
  ) => Effect.Effect<ProviderInstallState, OpenCodeInstallationError>;
  readonly state: Effect.Effect<ProviderInstallState>;
  readonly changes: Stream.Stream<ProviderInstallState>;
}

export class OpenCodeInstallation extends Context.Service<
  OpenCodeInstallation,
  OpenCodeInstallationService
>()("t3/provider/OpenCodeInstallation") {
  static readonly layer = Layer.effect(
    OpenCodeInstallation,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return yield* makeOpenCodeInstallation({ baseDir: config.baseDir });
    }),
  );
}

export interface OpenCodeInstallationOptions {
  readonly baseDir: string;
  readonly releaseAsset?: OpenCodeReleaseAsset | null;
  readonly validate?: (
    executablePath: string,
    expectedVersion: string,
  ) => Effect.Effect<void, OpenCodeInstallationError>;
}

const isRunning = (state: ProviderInstallState) =>
  ["downloading", "extracting", "verifying"].includes(state.phase);

const parseVersion = (output: string) => /^v?(\d+\.\d+\.\d+)\s*$/u.exec(output.trim())?.[1];

export const makeOpenCodeInstallation = Effect.fn("makeOpenCodeInstallation")(function* (
  options: OpenCodeInstallationOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const http = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serviceScope = yield* Effect.scope;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const arch = yield* HostProcess.Architecture;
  const asset =
    options.releaseAsset === undefined
      ? resolveOpenCodeReleaseAsset(platform, arch)
      : options.releaseAsset;
  const managedDirectory = path.join(options.baseDir, "tools", "opencode");
  const activePath = path.join(managedDirectory, "active.json");
  const executableName = platform === "win32" ? "opencode.exe" : "opencode";
  const gate = yield* Semaphore.make(1);
  let running: { readonly operationId: string; readonly fiber: Fiber.Fiber<void> } | undefined;
  const state = yield* SubscriptionRef.make<ProviderInstallState>({
    driver: DRIVER,
    operationId: null,
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: asset?.archiveBytes ?? null,
    version: asset?.version ?? null,
    installedVersion: null,
    executablePath: null,
    canRemove: false,
    message: null,
  });

  const readRecord = Effect.fn("OpenCodeInstallation.readRecord")(function* <A>(
    file: string,
    schema: Schema.Codec<A>,
  ) {
    const info = yield* fs.stat(file);
    if (info.type !== "File" || Number(info.size) > 8192)
      return yield* installationError(
        "resolve",
        "The managed OpenCode installation record is invalid.",
      );
    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(
      yield* fs.readFileString(file),
    );
  });

  const executableIn = Effect.fn("OpenCodeInstallation.executableIn")(function* (
    directory: string,
  ) {
    const executablePath = path.join(directory, executableName);
    const info = yield* fs.stat(executablePath);
    if (
      info.type !== "File" ||
      Number(info.size) === 0 ||
      (platform !== "win32" && (info.mode & 0o111) === 0)
    )
      return yield* installationError("verify", "The managed OpenCode package is incomplete.");
    return executablePath;
  });

  const completedRelease = Effect.fn("OpenCodeInstallation.completedRelease")(function* (
    version: string,
  ) {
    yield* decodeVersion(version);
    const directory = path.join(managedDirectory, version);
    const record = yield* readRecord(
      path.join(directory, ".install-complete.json"),
      InstalledRelease,
    );
    if (record.version !== version)
      return yield* installationError(
        "resolve",
        "The managed OpenCode installation record has the wrong version.",
      );
    return {
      executablePath: yield* executableIn(directory),
      source: "managed",
      version,
    } satisfies OpenCodeExecutable;
  });

  const runCommand = Effect.fn("OpenCodeInstallation.runCommand")(function* (
    command: string,
    args: ReadonlyArray<string>,
  ) {
    const resolved = yield* resolveSpawnCommand(command, args).pipe(
      Effect.provideService(HostProcess.Platform, platform),
    );
    const child = yield* spawner.spawn(
      ChildProcess.make(resolved.command, resolved.args, { shell: resolved.shell }),
    );
    const [output, , exitCode] = yield* Effect.all(
      [
        child.stdout.pipe(Stream.decodeText(), Stream.mkString),
        child.stderr.pipe(Stream.runDrain),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0)
      return yield* installationError(
        "verify",
        "Could not unpack or start the downloaded OpenCode package.",
      );
    return output;
  }, Effect.scoped);

  // A user's own OpenCode wins: it already has their providers and sign-ins.
  const resolveLocal = Effect.fn("OpenCodeInstallation.resolveLocal")(
    function* () {
      const executablePath = yield* resolveCommandPath(DEFAULT_BINARY, { env: environment }).pipe(
        Effect.provideService(HostProcess.Platform, platform),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      if (executablePath === null) return null;
      const realExecutablePath = yield* fs.realPath(executablePath);
      const realManaged = yield* fs.realPath(managedDirectory).pipe(Effect.option);
      if (
        realExecutablePath.startsWith(
          `${Option.getOrElse(realManaged, () => managedDirectory)}${path.sep}`,
        )
      )
        return null;
      const version = parseVersion(yield* runCommand(executablePath, ["--version"]));
      if (version === undefined || compareSemverVersions(version, MINIMUM_OPENCODE_VERSION) < 0)
        return null;
      return { executablePath, source: "local", version } satisfies OpenCodeExecutable;
    },
    Effect.timeout(VERSION_PROBE_TIMEOUT_MS),
    Effect.orElseSucceed(() => null),
  );

  const succeed = (executable: OpenCodeExecutable, operationId: string) =>
    SubscriptionRef.update(
      state,
      (current) =>
        ({
          ...current,
          operationId,
          phase: "succeeded",
          source: executable.source,
          installedVersion: executable.version,
          executablePath: executable.executablePath,
          downloadedBytes: executable.source === "local" ? 0 : current.downloadedBytes,
          message: null,
        }) satisfies ProviderInstallState,
    );

  const validate =
    options.validate ??
    Effect.fn("OpenCodeInstallation.validate")(
      function* (executablePath: string, version: string) {
        const output = yield* runCommand(executablePath, ["--version"]);
        if (parseVersion(output) !== version)
          return yield* installationError(
            "verify",
            "The downloaded OpenCode executable has the wrong version.",
          );
      },
      Effect.mapError(wrapFailure("verify", "The downloaded OpenCode runtime could not start.")),
    );

  const install = Effect.fn("OpenCodeInstallation.install")(
    function* (release: OpenCodeReleaseAsset, operationId: string) {
      yield* decodeVersion(release.version);
      yield* fs.makeDirectory(managedDirectory, { recursive: true });
      const destination = path.join(managedDirectory, release.version);
      const activate = Effect.fn("OpenCodeInstallation.activate")(
        function* () {
          const executable = yield* completedRelease(release.version);
          const temporary = yield* fs.makeTempDirectoryScoped({
            directory: managedDirectory,
            prefix: ".active-",
          });
          const pointer = path.join(temporary, "active.json");
          yield* fs.writeFileString(pointer, yield* encodeActive({ version: release.version }), {
            mode: 0o600,
            flag: "wx",
          });
          yield* fs.rename(pointer, activePath);
          yield* succeed(executable, operationId);
        },
        Effect.scoped,
        Effect.uninterruptible,
      );
      if (yield* fs.exists(destination)) {
        const record = yield* readRecord(
          path.join(destination, ".install-complete.json"),
          InstalledRelease,
        );
        if (record.sha256 !== release.sha256)
          return yield* installationError(
            "verify",
            "The existing managed OpenCode release differs from the official package.",
          );
        yield* validate(yield* executableIn(destination), release.version).pipe(
          Effect.timeout("90 seconds"),
        );
        yield* activate();
        return;
      }
      const staging = yield* fs.makeTempDirectoryScoped({
        directory: managedDirectory,
        prefix: ".install-",
      });
      const archivePath = path.join(staging, path.basename(new URL(release.url).pathname));
      const runtime = path.join(staging, "runtime");
      yield* fs.makeDirectory(runtime);
      const hash = NodeCrypto.createHash("sha256");
      let downloadedBytes = 0;
      let lastProgressAt = yield* Clock.currentTimeMillis;
      const stalled = () =>
        installationError(
          "download",
          "The OpenCode download stopped responding. Check your connection and try again.",
        );
      const response = yield* http.execute(HttpClientRequest.get(release.url)).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeoutOrElse({
          duration: DOWNLOAD_STALL_TIMEOUT,
          orElse: () => Effect.fail(stalled()),
        }),
        Effect.mapError(
          wrapFailure(
            "download",
            "Could not download OpenCode. Check your connection and try again.",
          ),
        ),
      );
      yield* response.stream.pipe(
        Stream.timeoutOrElse({
          duration: DOWNLOAD_STALL_TIMEOUT,
          orElse: () => Stream.fail(stalled()),
        }),
        Stream.tap((chunk) =>
          Effect.gen(function* () {
            downloadedBytes += chunk.byteLength;
            if (downloadedBytes > release.archiveBytes)
              return yield* installationError(
                "download",
                "The OpenCode download exceeded the expected release size.",
              );
            hash.update(chunk);
            const now = yield* Clock.currentTimeMillis;
            if (now - lastProgressAt >= 250 || downloadedBytes === release.archiveBytes) {
              lastProgressAt = now;
              yield* SubscriptionRef.update(state, (current) => ({ ...current, downloadedBytes }));
            }
          }),
        ),
        Stream.run(fs.sink(archivePath, { flag: "wx", mode: 0o600 })),
        Effect.mapError(
          wrapFailure(
            "download",
            "Could not download OpenCode. Check your connection and try again.",
          ),
        ),
      );
      if (downloadedBytes !== release.archiveBytes || hash.digest("hex") !== release.sha256)
        return yield* installationError(
          "download",
          "The OpenCode download failed its size or SHA-256 check. Nothing was installed.",
        );
      yield* SubscriptionRef.update(
        state,
        (current) =>
          ({
            ...current,
            phase: "extracting",
            message: "Extracting OpenCode.",
          }) satisfies ProviderInstallState,
      );
      // bsdtar (macOS, Windows System32) reads the zip archives; Linux gets tar.gz.
      const tarCommand = cliArchiveTarCommand(platform, environment);
      const entries = (yield* runCommand(tarCommand, ["-tf", archivePath]))
        .trim()
        .split(/\r?\n/u)
        .map((entry) => entry.replace(/^\.\//u, ""));
      if (entries.length !== 1 || entries[0] !== executableName)
        return yield* installationError("extract", "The OpenCode archive has unexpected entries.");
      yield* runCommand(tarCommand, ["-xf", archivePath, "-C", runtime]);
      yield* SubscriptionRef.update(
        state,
        (current) =>
          ({
            ...current,
            phase: "verifying",
            message: "Checking OpenCode.",
          }) satisfies ProviderInstallState,
      );
      yield* validate(yield* executableIn(runtime), release.version).pipe(
        Effect.timeout("90 seconds"),
      );
      yield* fs.writeFileString(
        path.join(runtime, ".install-complete.json"),
        yield* encodeRecord({ version: release.version, sha256: release.sha256 }),
        { flag: "wx", mode: 0o600 },
      );
      // On Windows, Defender can briefly hold the verified executable open after `--version`.
      const renameRuntime = fs.rename(runtime, destination);
      yield* platform === "win32"
        ? renameRuntime.pipe(Effect.retry({ times: 10, schedule: Schedule.spaced("100 millis") }))
        : renameRuntime;
      yield* activate();
    },
    Effect.scoped,
    Effect.mapError(
      wrapFailure(
        "install",
        "Could not install OpenCode. Check disk space and directory access, then try again.",
      ),
    ),
  );

  const start = gate
    .withPermit(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (isRunning(current)) return current;
        const operationId = yield* crypto.randomUUIDv4();
        const local = yield* resolveLocal();
        if (local) {
          yield* succeed(local, operationId);
          return yield* SubscriptionRef.get(state);
        }
        if (!asset) {
          return yield* installationError(
            "start",
            `OpenCode does not publish a runtime for ${platform}-${arch}. Set a binary path instead.`,
          );
        }
        const next: ProviderInstallState = {
          driver: DRIVER,
          operationId,
          phase: "downloading",
          downloadedBytes: 0,
          totalBytes: asset.archiveBytes,
          version: asset.version,
          installedVersion: current.installedVersion,
          canRemove: false,
          message: "Downloading OpenCode.",
        };
        yield* SubscriptionRef.set(state, next);
        const work = install(asset, operationId).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? SubscriptionRef.update(state, (value) => {
                  if (value.operationId !== operationId || value.phase === "succeeded")
                    return value;
                  const error = Cause.findErrorOption(exit.cause);
                  const cancelled = Cause.hasInterruptsOnly(exit.cause);
                  return {
                    ...value,
                    phase: cancelled ? "cancelled" : "failed",
                    message: cancelled
                      ? "Installation cancelled."
                      : Option.isSome(error)
                        ? error.value.detail
                        : "Could not finish the OpenCode installation.",
                  } satisfies ProviderInstallState;
                })
              : Effect.void,
          ),
          Effect.ignoreCause,
          Effect.ensuring(
            Effect.sync(() => {
              if (running?.operationId === operationId) running = undefined;
            }),
          ),
        );
        const fiber = yield* Effect.forkIn(Effect.interruptible(work), serviceScope);
        running = { operationId, fiber };
        return next;
      }).pipe(Effect.uninterruptible),
    )
    .pipe(Effect.mapError(wrapFailure("start", "Could not start the OpenCode installation.")));

  const cancel = Effect.fn("OpenCodeInstallation.cancel")(function* (operationId: string) {
    return yield* gate.withPermit(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (current.operationId !== operationId) {
          return yield* installationError(
            "cancel",
            "This installation is no longer current. Refresh its status before cancelling.",
          );
        }
        if (running?.operationId === operationId && isRunning(current)) {
          yield* Fiber.interrupt(running.fiber);
        }
        return yield* SubscriptionRef.get(state);
      }),
    );
  });

  yield* Effect.gen(function* () {
    if (!(yield* fs.exists(managedDirectory))) return;
    // Download is bounded by the stall timeout, so a day-old staging directory is abandoned.
    const entries = yield* fs
      .readDirectory(managedDirectory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const now = yield* Clock.currentTimeMillis;
    for (const entry of entries) {
      if (!entry.startsWith(".install-") && !entry.startsWith(".active-")) continue;
      const target = path.join(managedDirectory, entry);
      const info = yield* fs.stat(target).pipe(Effect.option);
      if (Option.isNone(info)) continue;
      const modifiedAt = Option.match(info.value.mtime, {
        onNone: () => now,
        onSome: (date) => date.getTime(),
      });
      if (now - modifiedAt < STAGING_STALE_AFTER_MS) continue;
      yield* fs.remove(target, { recursive: true, force: true }).pipe(Effect.ignore);
    }
    if (!(yield* fs.exists(activePath))) return;
    const active = yield* readRecord(activePath, ActiveRelease);
    const installed = yield* completedRelease(active.version);
    yield* SubscriptionRef.update(
      state,
      (current) =>
        ({
          ...current,
          installedVersion: installed.version,
          executablePath: installed.executablePath,
          source: "managed",
        }) satisfies ProviderInstallState,
    );
  }).pipe(Effect.ignore);

  return OpenCodeInstallation.of({
    managedDirectory,
    start,
    cancel,
    state: SubscriptionRef.get(state),
    changes: SubscriptionRef.changes(state),
  });
});

/**
 * Turns on the default OpenCode instance once a started install finishes. A
 * managed runtime is written as its binary path; a custom path is never replaced.
 */
export const activateOpenCodeInstance = Effect.fn("OpenCodeInstallation.activateInstance")(
  function* (installed: ProviderInstallState, managedDirectory: string) {
    if (installed.phase !== "succeeded" || installed.operationId === null) return;
    const settings = yield* ServerSettings.ServerSettingsService;
    const path = yield* Path.Path;
    const current = yield* settings.getSettings;
    const instanceId = defaultInstanceIdForDriver(DRIVER);
    const instance = current.providerInstances[instanceId] ?? { driver: DRIVER };
    const config =
      instance.config !== null && typeof instance.config === "object"
        ? (instance.config as Record<string, unknown>)
        : {};
    const configured = typeof config.binaryPath === "string" ? config.binaryPath.trim() : "";
    const replaceable =
      configured === "" ||
      configured === DEFAULT_BINARY ||
      configured.startsWith(`${managedDirectory}${path.sep}`);
    const binaryPath =
      installed.source === "managed" && installed.executablePath && replaceable
        ? installed.executablePath
        : configured || undefined;
    if (instance.enabled === true && config.enabled !== false && configured === (binaryPath ?? ""))
      return;
    const { binaryPath: _previous, ...rest } = config;
    yield* settings.updateProviderInstance({
      operation: "upsert",
      instanceId,
      instance: {
        ...instance,
        enabled: true,
        config: {
          ...rest,
          ...(config.enabled === false ? { enabled: true } : {}),
          ...(binaryPath === undefined ? {} : { binaryPath }),
        },
      },
    });
  },
);

export const layerOpenCodeActivation = Layer.effectDiscard(
  Effect.gen(function* () {
    const installation = yield* OpenCodeInstallation;
    yield* installation.changes.pipe(
      Stream.filter((state) => state.phase === "succeeded" && state.operationId !== null),
      Stream.changesWith((a, b) => a.operationId === b.operationId),
      Stream.runForEach((state) =>
        activateOpenCodeInstance(state, installation.managedDirectory).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not turn on OpenCode after installing it.", cause),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
