import { HostProcessPlatform } from "@upcomputer/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;
export const TAILSCALE_STATUS_TIMEOUT = Duration.millis(1_500);
export const TAILSCALE_SERVE_TIMEOUT = Duration.seconds(10);
export const TAILSCALE_PROBE_TIMEOUT = Duration.millis(2_500);

/**
 * The CLI inside the macOS app. The standalone and App Store apps only put
 * `tailscale` on PATH when the user installs it from Tailscale's settings, and
 * that installed command is a shell wrapper that execs this binary with the
 * same arguments. Tailscale documents running it directly.
 */
export const MACOS_TAILSCALE_APP_EXECUTABLE =
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

const TailscaleExecutable = Schema.Literals([
  "tailscale",
  "tailscale.exe",
  MACOS_TAILSCALE_APP_EXECUTABLE,
]);
type TailscaleExecutable = typeof TailscaleExecutable.Type;

// tailscale is a real executable everywhere (`tailscale.exe` on Windows), so
// it is always spawned directly rather than through cmd.exe shell mode. The
// candidates are tried in order; a later one is used only when the earlier
// ones fail to spawn.
const tailscaleExecutablesForPlatform = (
  platform: NodeJS.Platform,
): readonly [TailscaleExecutable, ...TailscaleExecutable[]] => {
  switch (platform) {
    case "win32":
      return ["tailscale.exe"];
    case "darwin":
      return ["tailscale", MACOS_TAILSCALE_APP_EXECUTABLE];
    default:
      return ["tailscale"];
  }
};

const TailscaleCommandContext = {
  executable: TailscaleExecutable,
  subcommand: Schema.Literals(["status", "serve"]),
  argumentCount: Schema.Number,
};

/**
 * Failure kinds we can name without quoting the CLI. Anything unrecognized
 * becomes "unknown" rather than falling back to raw text — stderr can contain
 * auth keys (`tskey-…`) and node names, and these labels are logged.
 */
export const TailscaleStderrDiagnostic = Schema.Literals([
  "no-existing-handler",
  "not-logged-in",
  "permission-denied",
  "unknown",
]);
export type TailscaleStderrDiagnostic = typeof TailscaleStderrDiagnostic.Type;

// Matched against stderr, most specific first. Patterns are deliberately short
// and anchored on tailscale's own wording.
const STDERR_DIAGNOSTIC_PATTERNS: ReadonlyArray<
  readonly [RegExp, Exclude<TailscaleStderrDiagnostic, "unknown">]
> = [
  [/handler does not exist/i, "no-existing-handler"],
  [/not logged in|logged out|needs? login/i, "not-logged-in"],
  [/permission denied|access denied|must be root|operation not permitted/i, "permission-denied"],
];

/** Classifies stderr into a safe label, dropping the text itself. */
export const stderrDiagnosticOf = (stderr: string): TailscaleStderrDiagnostic | undefined => {
  if (stderr.trim().length === 0) {
    return undefined;
  }
  return STDERR_DIAGNOSTIC_PATTERNS.find(([pattern]) => pattern.test(stderr))?.[1] ?? "unknown";
};

export class TailscaleCommandSpawnError extends Schema.TaggedErrorClass<TailscaleCommandSpawnError>()(
  "TailscaleCommandSpawnError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to spawn tailscale ${this.subcommand}.`;
  }
}

export class TailscaleCommandOutputError extends Schema.TaggedErrorClass<TailscaleCommandOutputError>()(
  "TailscaleCommandOutputError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read output from tailscale ${this.subcommand}.`;
  }
}

/**
 * The tail of what `tailscale serve` printed, for showing the owner of this
 * machine why it failed. Redacted, so logging the error prints `<redacted>`:
 * the text can name nodes. Auth keys are masked even inside.
 */
const TailscaleOutputExcerpt = Schema.optional(Schema.Redacted(Schema.String));

export class TailscaleCommandExitError extends Schema.TaggedErrorClass<TailscaleCommandExitError>()(
  "TailscaleCommandExitError",
  {
    ...TailscaleCommandContext,
    exitCode: Schema.Number,
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.Number,
    // A classified diagnostic, never raw CLI output. `tailscale` prints auth
    // keys and node identifiers into stderr, and this field is surfaced in
    // dev-runner logs — so it carries only a known-safe label from the closed
    // set below. Callers that need to recognize a specific failure (e.g.
    // `serve off` on a port with no mapping) match on the label.
    stderrDiagnostic: Schema.optional(TailscaleStderrDiagnostic),
    outputExcerpt: TailscaleOutputExcerpt,
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} exited with code ${this.exitCode}.`;
  }
}

export class TailscaleCommandTimeoutError extends Schema.TaggedErrorClass<TailscaleCommandTimeoutError>()(
  "TailscaleCommandTimeoutError",
  {
    ...TailscaleCommandContext,
    timeoutMs: Schema.Number,
    cause: Schema.Defect(),
    outputExcerpt: TailscaleOutputExcerpt,
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} timed out after ${this.timeoutMs}ms.`;
  }
}

/**
 * `tailscale serve` stopped to ask for approval: the tailnet has not enabled
 * HTTPS for Serve yet. The command would otherwise block until someone opens
 * the link and approves.
 */
export class TailscaleServeApprovalRequiredError extends Schema.TaggedErrorClass<TailscaleServeApprovalRequiredError>()(
  "TailscaleServeApprovalRequiredError",
  {
    ...TailscaleCommandContext,
    // The login.tailscale.com link names this node, so logs print it redacted.
    approvalUrl: Schema.Redacted(Schema.String),
  },
) {
  override get message(): string {
    return "Tailscale Serve needs approval for this tailnet.";
  }
}

export const TailscaleCommandError = Schema.Union([
  TailscaleCommandSpawnError,
  TailscaleCommandOutputError,
  TailscaleCommandExitError,
  TailscaleCommandTimeoutError,
]);
export type TailscaleCommandError = typeof TailscaleCommandError.Type;

export type TailscaleServeError = TailscaleCommandError | TailscaleServeApprovalRequiredError;

// When the tailnet has not enabled HTTPS, `tailscale serve` prints the control
// server's explanation and a link on its own line to stdout, then waits for the
// approval (cmd/tailscale/cli: enableFeatureInteractive). The lookahead only
// accepts a link followed by whitespace, so a link split across output chunks
// is not taken early.
const TAILSCALE_APPROVAL_URL_PATTERN = /https:\/\/login\.tailscale\.com\/[^\s]+(?=\s)/u;

/** The approval link in `tailscale serve` output, or null. */
export const findTailscaleApprovalUrl = (output: string): string | null =>
  TAILSCALE_APPROVAL_URL_PATTERN.exec(output)?.[0] ?? null;

const OUTPUT_EXCERPT_MAX_LENGTH = 400;

/** The tail of CLI output with auth keys masked, or undefined when empty. */
export const excerptTailscaleOutput = (output: string): string | undefined => {
  const text = output.replace(/tskey-[\w-]+/gu, "tskey-…").trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length > OUTPUT_EXCERPT_MAX_LENGTH
    ? `…${text.slice(-OUTPUT_EXCERPT_MAX_LENGTH).trimStart()}`
    : text;
};

const outputExcerptField = (output: string) => {
  const excerpt = excerptTailscaleOutput(output);
  return excerpt === undefined ? {} : { outputExcerpt: Redacted.make(excerpt) };
};

export class TailscaleStatusParseError extends Schema.TaggedErrorClass<TailscaleStatusParseError>()(
  "TailscaleStatusParseError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to decode tailscale status JSON.";
  }
}

const TailscaleStatusSelf = Schema.Struct({
  DNSName: Schema.optional(Schema.Unknown),
  TailscaleIPs: Schema.optional(Schema.Unknown),
});

const TailscaleStatusJson = Schema.Struct({
  Self: Schema.optional(TailscaleStatusSelf),
});

export type TailscaleStatusSelf = typeof TailscaleStatusSelf.Type;
export type TailscaleStatusJson = typeof TailscaleStatusJson.Type;

export interface TailscaleStatus {
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

const collectStdout = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const collectStderr = collectStdout;

const decodeTailscaleStatusJson = Schema.decodeEffect(Schema.fromJsonString(TailscaleStatusJson));

function normalizeMagicDnsName(status: TailscaleStatusJson): string | null {
  const dnsName = status.Self?.DNSName;
  if (typeof dnsName !== "string") {
    return null;
  }

  const normalized = dnsName.trim().replace(/\.$/u, "");
  return normalized.length > 0 ? normalized : null;
}

export const parseTailscaleMagicDnsName = (
  rawStatusJson: string,
): Effect.Effect<string | null, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map(normalizeMagicDnsName),
  );

export function isTailscaleIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const [first, second, third, fourth] = parts.map((part) => Number.parseInt(part, 10));
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    [first, second, third, fourth].some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return first === 100 && second >= 64 && second <= 127;
}

export const parseTailscaleStatus = (
  rawStatusJson: string,
): Effect.Effect<TailscaleStatus, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      const rawIps = parsed.Self?.TailscaleIPs;
      const tailnetIpv4Addresses: Array<string> = [];
      if (Array.isArray(rawIps)) {
        for (const address of rawIps) {
          if (typeof address === "string" && isTailscaleIpv4Address(address)) {
            tailnetIpv4Addresses.push(address);
          }
        }
      }

      return {
        magicDnsName: normalizeMagicDnsName(parsed),
        tailnetIpv4Addresses,
      };
    }),
  );

type TailscaleSubcommand = typeof TailscaleCommandContext.subcommand.Type;

interface TailscaleCommandContextValue {
  readonly executable: TailscaleExecutable;
  readonly subcommand: TailscaleSubcommand;
  readonly argumentCount: number;
}

/**
 * Spawns the first tailscale executable that starts, in platform order.
 * `context.current` names the executable that was spawned (or last tried), so
 * errors raised after spawning, such as timeouts, report the right one.
 */
const spawnTailscale = (input: {
  readonly args: readonly string[];
  readonly context: { current: TailscaleCommandContextValue };
}) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const hostPlatform = yield* HostProcessPlatform;
    const [first, ...fallbacks] = tailscaleExecutablesForPlatform(hostPlatform);
    const spawnOne = (executable: TailscaleExecutable) => {
      const commandContext = { ...input.context.current, executable };
      input.context.current = commandContext;
      return spawner.spawn(ChildProcess.make(executable, input.args)).pipe(
        Effect.mapError((cause) => new TailscaleCommandSpawnError({ ...commandContext, cause })),
        // Spawning can also fail as a defect rather than a typed error - a
        // non-directory entry on PATH makes node throw ENOTDIR synchronously.
        // `mapError` never sees that, so it would escape as an uncaught error.
        Effect.catchDefect((cause) =>
          Effect.fail(new TailscaleCommandSpawnError({ ...commandContext, cause })),
        ),
      );
    };
    return yield* fallbacks.reduce(
      (spawned, executable) =>
        spawned.pipe(Effect.catchTag("TailscaleCommandSpawnError", () => spawnOne(executable))),
      spawnOne(first),
    );
  });

const initialCommandContext = (
  subcommand: TailscaleSubcommand,
  args: readonly string[],
): { current: TailscaleCommandContextValue } => ({
  current: { executable: "tailscale", subcommand, argumentCount: args.length },
});

export const readTailscaleStatus = Effect.gen(function* () {
  const args = ["status", "--json"];
  const context = initialCommandContext("status", args);
  return yield* Effect.gen(function* () {
    const child = yield* spawnTailscale({ args, context });
    const commandContext = context.current;
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStdout(child.stdout),
        collectStderr(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((cause) => new TailscaleCommandOutputError({ ...commandContext, cause })),
    );
    if (exitCode !== 0) {
      return yield* new TailscaleCommandExitError({
        ...commandContext,
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        ...(stderrDiagnosticOf(stderr) !== undefined
          ? { stderrDiagnostic: stderrDiagnosticOf(stderr) }
          : {}),
      });
    }
    return yield* parseTailscaleStatus(stdout);
  }).pipe(
    Effect.scoped,
    Effect.timeout(TAILSCALE_STATUS_TIMEOUT),
    Effect.catchTags({
      TimeoutError: (cause) =>
        Effect.fail(
          new TailscaleCommandTimeoutError({
            ...context.current,
            timeoutMs: Duration.toMillis(TAILSCALE_STATUS_TIMEOUT),
            cause,
          }),
        ),
    }),
  );
});

export function buildTailscaleHttpsBaseUrl(input: {
  readonly magicDnsName: string;
  readonly servePort?: number;
}): string {
  const url = new URL(`https://${input.magicDnsName}`);
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  if (servePort !== DEFAULT_TAILSCALE_SERVE_PORT) {
    url.port = String(servePort);
  }
  url.pathname = "/";
  return url.toString();
}

const runTailscaleServeCommand = (
  args: readonly string[],
  timeoutInput: Duration.Input,
): Effect.Effect<void, TailscaleServeError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const context = initialCommandContext("serve", args);
    const timeout = Duration.fromInputUnsafe(timeoutInput);
    // Everything printed so far, in arrival order, for the approval link and
    // for failure excerpts (including a timeout's).
    const output = yield* Ref.make("");
    return yield* Effect.gen(function* () {
      const child = yield* spawnTailscale({ args, context });
      const commandContext = context.current;
      const approvalUrl = yield* Deferred.make<string>();
      // Collects one stream like collectStdout, also appending to `output`
      // and resolving `approvalUrl` once the link shows up.
      const record = <E>(stream: Stream.Stream<Uint8Array, E>) =>
        stream.pipe(
          Stream.decodeText(),
          Stream.tap((chunk) =>
            Ref.updateAndGet(output, (printed) => printed + chunk).pipe(
              Effect.flatMap((printed) => {
                const url = findTailscaleApprovalUrl(printed);
                return url === null ? Effect.void : Deferred.succeed(approvalUrl, url);
              }),
            ),
          ),
          Stream.runFold(
            () => "",
            (acc, chunk) => acc + chunk,
          ),
        );
      const approvalRequired = (url: string) =>
        new TailscaleServeApprovalRequiredError({
          ...commandContext,
          approvalUrl: Redacted.make(url),
        });

      const [, stderr, exitCode] = yield* Effect.all(
        [record(child.stdout), record(child.stderr), child.exitCode.pipe(Effect.map(Number))],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError((cause) => new TailscaleCommandOutputError({ ...commandContext, cause })),
        // Stop waiting as soon as the link appears; leaving the scope kills
        // the waiting CLI. It has changed nothing yet: serve asks for approval
        // before it touches the serve config.
        Effect.raceFirst(
          Deferred.await(approvalUrl).pipe(Effect.flatMap((url) => approvalRequired(url))),
        ),
      );
      // Without a wait, serve prints the link and exits 0 unconfigured.
      const approvalUrlAfterExit = findTailscaleApprovalUrl(`${yield* Ref.get(output)}\n`);
      if (approvalUrlAfterExit !== null) {
        return yield* approvalRequired(approvalUrlAfterExit);
      }
      if (exitCode !== 0) {
        return yield* new TailscaleCommandExitError({
          ...commandContext,
          exitCode,
          stderrLength: stderr.length,
          ...(stderrDiagnosticOf(stderr) !== undefined
            ? { stderrDiagnostic: stderrDiagnosticOf(stderr) }
            : {}),
          ...outputExcerptField(stderr.trim().length > 0 ? stderr : yield* Ref.get(output)),
        });
      }
    }).pipe(
      Effect.scoped,
      Effect.timeout(timeout),
      Effect.catchTags({
        TimeoutError: (cause) =>
          Ref.get(output).pipe(
            Effect.flatMap((printed) =>
              Effect.fail(
                new TailscaleCommandTimeoutError({
                  ...context.current,
                  timeoutMs: Duration.toMillis(timeout),
                  cause,
                  ...outputExcerptField(printed),
                }),
              ),
            ),
          ),
      }),
    );
  });

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}): Effect.Effect<void, TailscaleServeError, ChildProcessSpawner.ChildProcessSpawner> => {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  const localHost = input.localHost ?? "127.0.0.1";
  const args = ["serve", "--bg", `--https=${servePort}`, `http://${localHost}:${input.localPort}`];
  return runTailscaleServeCommand(args, TAILSCALE_SERVE_TIMEOUT);
};

export const disableTailscaleServe = (
  input: {
    readonly servePort?: number;
  } = {},
): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
    return yield* runTailscaleServeCommand(
      ["serve", `--https=${servePort}`, "off"],
      TAILSCALE_SERVE_TIMEOUT,
    ).pipe(
      // `serve ... off` skips the approval flow, so this cannot happen.
      Effect.catchTag("TailscaleServeApprovalRequiredError", (error) => Effect.die(error)),
    );
  });

export const probeTailscaleHttpsEndpoint = (input: {
  readonly baseUrl: string;
  readonly timeout?: Duration.Input;
}): Effect.Effect<boolean, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* Effect.gen(function* () {
      const url = new URL("/.well-known/upcomputer/environment", input.baseUrl);
      const request = HttpClientRequest.get(url.toString());
      return yield* client.execute(request);
    }).pipe(Effect.timeoutOption(input.timeout ?? TAILSCALE_PROBE_TIMEOUT));

    return Option.match(response, {
      onNone: () => false,
      onSome: (httpResponse) => httpResponse.status >= 200 && httpResponse.status < 300,
    });
  }).pipe(Effect.orElseSucceed(() => false));

export const resolveTailscaleHttpsBaseUrl = (
  input: {
    readonly servePort?: number;
  } = {},
): Effect.Effect<
  string | null,
  TailscaleCommandError | TailscaleStatusParseError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  readTailscaleStatus.pipe(
    Effect.map((status) =>
      status.magicDnsName
        ? buildTailscaleHttpsBaseUrl({
            magicDnsName: status.magicDnsName,
            ...(input.servePort === undefined ? {} : { servePort: input.servePort }),
          })
        : null,
    ),
  );
