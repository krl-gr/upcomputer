import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstallState,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
import * as ServerSettings from "../serverSettings.ts";
import { resolveCodexReleaseAsset } from "./CodexInstallation.ts";
import * as OpenCodeInstallation from "./OpenCodeInstallation.ts";

// A tar.gz holding one `opencode` script that prints 1.19.3.
const archive = Buffer.from(
  "H4sIAMUg2WoAA+3PPQ6AIAyGYWdPUeMOBS3E4yiS6CLGn/uLgwurIcakz/Jtzduw+sWF0RcZIaIlgnujdCNtQJE2RmtskAAV2pYKwJxRj3M/+i2mvL2TPvcTdSWHeZH7VHo3BVBCdaIpv65ijDGW2wWoGr18AAgAAA==",
  "base64",
);

const makeHarness = Effect.fn("test.makeOpenCodeInstallation")(function* (
  input: {
    baseDir?: string;
    local?: string;
    body?: Stream.Stream<Uint8Array>;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const baseDir =
    input.baseDir ?? (yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-install-test-" }));
  const localDirectory = `${baseDir}/local`;
  const localBinaryPath = `${localDirectory}/opencode`;
  if (input.local) {
    yield* fs.makeDirectory(localDirectory, { recursive: true });
    yield* fs.writeFileString(localBinaryPath, `#!/bin/sh\necho ${input.local}\n`, {
      mode: 0o755,
    });
  }
  const crypto = yield* Crypto.Crypto;
  const sha256 = Hex.encode(yield* crypto.digest("SHA-256", archive).pipe(Effect.orDie));
  let downloads = 0;
  const installation = yield* OpenCodeInstallation.makeOpenCodeInstallation({
    baseDir,
    releaseAsset: {
      version: "1.19.3",
      url: "https://github.com/sst/opencode/releases/download/test/opencode-test.tar.gz",
      sha256,
      archiveBytes: archive.length,
    },
  }).pipe(
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provideService(HostProcess.Architecture, "arm64"),
    Effect.provideService(HostProcess.Environment, { PATH: input.local ? localDirectory : "" }),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          downloads++;
          return Object.defineProperty(
            HttpClientResponse.fromWeb(request, new Response(null)),
            "stream",
            { value: input.body ?? Stream.succeed(archive) },
          );
        }),
      ),
    ),
  );
  return { installation, fs, baseDir, localBinaryPath, downloads: () => downloads };
});

it.each([
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["win32", "arm64"],
  ["win32", "x64"],
] as const)("pins one OpenCode release for %s-%s, like Codex", (platform, arch) => {
  expect(resolveCodexReleaseAsset(platform, arch)).not.toBeNull();
  expect(OpenCodeInstallation.resolveOpenCodeReleaseAsset(platform, arch)).toMatchObject({
    version: "1.19.3",
    url: expect.stringMatching(
      /^https:\/\/github\.com\/sst\/opencode\/releases\/download\/v1\.19\.3\//u,
    ),
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
  });
});

const terminalState = (installation: OpenCodeInstallation.OpenCodeInstallation["Service"]) =>
  installation.changes.pipe(
    Stream.filter((state) => ["succeeded", "failed", "cancelled"].includes(state.phase)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.effect.each(["1.14.19", "1.19.3", "2.0.1"])(
  "uses an installed OpenCode %s and downloads nothing",
  (version) =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ local: version });
      const state = yield* h.installation.start;
      expect(state).toMatchObject({
        phase: "succeeded",
        source: "local",
        installedVersion: version,
        executablePath: h.localBinaryPath,
      });
      expect(state.operationId).not.toBeNull();
      expect(h.downloads()).toBe(0);
      expect(yield* h.fs.exists(h.installation.managedDirectory)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("downloads the pinned release past an old OpenCode and reuses it next launch", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({ local: "1.14.0" });
    yield* h.installation.start;
    const installed = yield* terminalState(h.installation);
    expect(installed).toMatchObject({
      phase: "succeeded",
      source: "managed",
      installedVersion: "1.19.3",
      executablePath: `${h.installation.managedDirectory}/1.19.3/opencode`,
    });
    expect(h.downloads()).toBe(1);
    expect(yield* h.fs.exists(h.localBinaryPath)).toBe(true);

    const relaunched = yield* makeHarness({ baseDir: h.baseDir });
    expect(yield* relaunched.installation.state).toMatchObject({
      installedVersion: "1.19.3",
      source: "managed",
    });
    yield* relaunched.installation.start;
    expect(yield* terminalState(relaunched.installation)).toMatchObject({
      phase: "succeeded",
      executablePath: installed.executablePath,
    });
    expect(relaunched.downloads()).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects a corrupted download without installing anything", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({ body: Stream.succeed(new Uint8Array(archive.length)) });
    yield* h.installation.start;
    const failed = yield* terminalState(h.installation);
    expect(failed.phase).toBe("failed");
    expect(failed.message).toContain("SHA-256");
    expect(yield* h.fs.exists(`${h.installation.managedDirectory}/1.19.3`)).toBe(false);
    expect(yield* h.fs.exists(`${h.installation.managedDirectory}/active.json`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("fails a stalled download so the user can retry", () =>
  Effect.gen(function* () {
    const stalled = yield* Deferred.make<void>();
    const h = yield* makeHarness({
      body: Stream.succeed(archive.subarray(0, 10)).pipe(
        Stream.concat(Stream.fromEffect(Deferred.succeed(stalled, undefined)).pipe(Stream.drain)),
        Stream.concat(Stream.never),
      ),
    });
    yield* h.installation.start;
    yield* Deferred.await(stalled);
    yield* Effect.yieldNow;
    yield* TestClock.adjust("31 seconds");
    const failed = yield* terminalState(h.installation);
    expect(failed.phase).toBe("failed");
    expect(failed.message).toContain("stopped responding");
    yield* h.installation.start;
    expect((yield* h.installation.state).phase).toBe("downloading");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const openCodeId = ProviderInstanceId.make("opencode");
const openCode = ProviderDriverKind.make("opencode");
const succeeded = (overrides: Partial<ProviderInstallState>): ProviderInstallState => ({
  driver: openCode,
  operationId: "operation",
  phase: "succeeded",
  downloadedBytes: 0,
  totalBytes: null,
  version: "1.19.3",
  installedVersion: "1.19.3",
  executablePath: "/home/.t3/tools/opencode/1.19.3/opencode",
  source: "managed",
  canRemove: false,
  message: null,
  ...overrides,
});
const activate = (
  installed: ProviderInstallState,
  settings?: Parameters<typeof ServerSettings.layerTest>[0],
) =>
  Effect.gen(function* () {
    yield* OpenCodeInstallation.activateOpenCodeInstance(installed, "/home/.t3/tools/opencode");
    const service = yield* ServerSettings.ServerSettingsService;
    return (yield* service.getSettings).providerInstances[openCodeId];
  }).pipe(Effect.provide(ServerSettings.layerTest(settings)));

it.effect("turns on OpenCode with the managed runtime as its binary path", () =>
  Effect.gen(function* () {
    expect(yield* activate(succeeded({}))).toMatchObject({
      driver: "opencode",
      enabled: true,
      config: { binaryPath: "/home/.t3/tools/opencode/1.19.3/opencode" },
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("turns on a local OpenCode without pinning its path", () =>
  Effect.gen(function* () {
    const instance = yield* activate(
      succeeded({ source: "local", executablePath: "/Users/me/.opencode/bin/opencode" }),
    );
    expect(instance?.enabled).toBe(true);
    expect(instance?.config).toEqual({});
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps a custom binary path and ignores the startup state", () =>
  Effect.gen(function* () {
    const settings = {
      providerInstances: {
        [openCodeId]: {
          driver: openCode,
          enabled: false,
          config: { binaryPath: "/opt/opencode", serverUrl: "" },
        },
      },
    };
    expect(yield* activate(succeeded({}), settings)).toMatchObject({
      enabled: true,
      config: { binaryPath: "/opt/opencode", serverUrl: "" },
    });
    expect(yield* activate(succeeded({ operationId: null }), settings)).toMatchObject({
      enabled: false,
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);
