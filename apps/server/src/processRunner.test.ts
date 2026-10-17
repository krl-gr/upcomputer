import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { MacDeveloperDirectoryProbe, SpawnExecutableResolution } from "@t3tools/shared/shell";

import * as ProcessRunner from "./processRunner.ts";

type ChildProcessCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: {
    readonly shell?: boolean | string;
  };
};

function asChildProcessCommand(command: unknown): ChildProcessCommand {
  return command as ChildProcessCommand;
}

function makeHandle(input: {
  readonly stdout?: string | Stream.Stream<Uint8Array>;
  readonly stderr?: string | Stream.Stream<Uint8Array>;
  readonly code?: number;
  readonly stdin?: ChildProcessSpawner.ChildProcessHandle["stdin"];
  readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode>;
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: input.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(input.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: input.stdin ?? Sink.drain,
    stdout:
      typeof input.stdout === "string"
        ? Stream.encodeText(Stream.make(input.stdout))
        : (input.stdout ?? Stream.empty),
    stderr:
      typeof input.stderr === "string"
        ? Stream.encodeText(Stream.make(input.stderr))
        : (input.stderr ?? Stream.empty),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function makeSpawner(
  f: (
    command: ChildProcessCommand,
  ) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle, PlatformError.PlatformError>,
) {
  return ChildProcessSpawner.make((command) => f(asChildProcessCommand(command)));
}

const runWith =
  (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  (input: ProcessRunner.ProcessRunInput) =>
    Effect.service(ProcessRunner.ProcessRunner).pipe(
      Effect.flatMap((runner) =>
        runner.run({
          ...input,
        }),
      ),
      Effect.provide(
        ProcessRunner.layer.pipe(
          Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        ),
      ),
    );

describe("runProcess", () => {
  it.effect("collects stdout through an injected ChildProcessSpawner", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner((command) =>
        Effect.sync(() => {
          expect(command.command).toBe("fake");
          expect(command.args).toEqual(["stdout-bytes", "32"]);
          return makeHandle({ stdout: "x".repeat(32) });
        }),
      );

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stdout-bytes", "32"],
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("x".repeat(32));
      expect(result.timedOut).toBe(false);
    }),
  );

  it.effect("runs through the ProcessRunner service", () => {
    const spawner = makeSpawner((command) =>
      Effect.sync(() => {
        expect(command.command).toBe("fake");
        expect(command.args).toEqual(["--service"]);
        return makeHandle({ stdout: "service ok" });
      }),
    );
    const layer = ProcessRunner.layer.pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    );

    return Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const result = yield* runner.run({
        command: "fake",
        args: ["--service"],
      });

      expect(result.stdout).toBe("service ok");
    }).pipe(Effect.provide(layer));
  });

  it.effect("resolves and escapes Windows command shims before spawning", () => {
    const spawner = makeSpawner((command) =>
      Effect.sync(() => {
        expect(command.command).toBe(
          [
            '^"C:\\Users\\tester\\AppData\\Roaming\\npm\\az.cmd^"',
            '^"repos^"',
            '^"pr^"',
            '^"list^"',
            '^"--source-branch^"',
            '^"feature^ ^&^ release^"',
          ].join(" "),
        );
        expect(command.args).toEqual([]);
        expect(command.options.shell).toBe(true);
        return makeHandle({ stdout: "[]" });
      }),
    );

    return runWith(spawner)({
      command: "az",
      args: ["repos", "pr", "list", "--source-branch", "feature & release"],
      env: { AZURE_CONFIG_DIR: "C:\\Users\\tester\\.azure" },
    }).pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, {
        PATH: "C:\\Users\\tester\\AppData\\Roaming\\npm",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      }),
      Effect.provideService(SpawnExecutableResolution, (_command, _platform, env) =>
        env.PATH === "C:\\Users\\tester\\AppData\\Roaming\\npm" &&
        env.AZURE_CONFIG_DIR === "C:\\Users\\tester\\.azure"
          ? "C:\\Users\\tester\\AppData\\Roaming\\npm\\az.cmd"
          : undefined,
      ),
      Effect.map((result) => {
        expect(result.stdout).toBe("[]");
      }),
    );
  });

  it.effect("preserves resolved spawn context and cause", () =>
    Effect.gen(function* () {
      const cause = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "ChildProcessSpawner",
        method: "spawn",
        pathOrDescriptor: "/actual/fake",
      });
      const spawner = makeSpawner(() => Effect.fail(cause));

      const error = yield* runWith(spawner)({
        command: "fake",
        args: ["--flag", "secret-token-value"],
        cwd: "/logical",
        spawnCwd: "/actual",
      }).pipe(Effect.flip);

      expect(error._tag).toBe("ProcessSpawnError");
      if (error._tag !== "ProcessSpawnError") {
        return expect.fail("Expected ProcessSpawnError");
      }
      expect(error).toMatchObject({
        command: "fake",
        argumentCount: 2,
        cwd: "/logical",
        spawnCwd: "/actual",
        resolvedCommand: "fake",
        resolvedArgumentCount: 2,
        shell: false,
      });
      expect(error.cause).toBe(cause);
      expect(error.message).toBe("Failed to spawn process 'fake' in '/actual'");
      expect(error).not.toHaveProperty("args");
      expect(error).not.toHaveProperty("resolvedArgs");
      expect(error.message).not.toContain("secret-token-value");
    }),
  );

  it.effect.each([
    { developerTools: false, spawned: false },
    { developerTools: true, spawned: true },
  ])(
    "runs Apple's git stub only once the developer tools exist: %o",
    ({ developerTools, spawned }) =>
      Effect.gen(function* () {
        const spawns: Array<string> = [];
        const spawner = makeSpawner((command) =>
          Effect.sync(() => {
            spawns.push(command.command);
            return makeHandle({ stdout: "true" });
          }),
        );

        const result = yield* runWith(spawner)({
          command: "git",
          args: ["rev-parse", "--is-inside-work-tree"],
          cwd: "/Users/new/.upcomputer",
        }).pipe(
          Effect.provideService(HostProcess.Platform, "darwin"),
          Effect.provideService(HostProcess.Environment, { PATH: "/usr/bin:/bin" }),
          Effect.provideService(SpawnExecutableResolution, () => "/usr/bin/git"),
          Effect.provideService(MacDeveloperDirectoryProbe, () => developerTools),
          Effect.result,
        );

        expect(spawns).toEqual(spawned ? ["git"] : []);
        if (spawned) return;
        // Reads as git not being installed, so its callers turn the feature off quietly.
        expect(result._tag).toBe("Failure");
        if (result._tag !== "Failure" || result.failure._tag !== "ProcessSpawnError") {
          return expect.fail("Expected ProcessSpawnError");
        }
        const cause = result.failure.cause;
        expect(PlatformError.isPlatformError(cause) && cause.reason._tag).toBe("NotFound");
      }),
  );

  it.effect.each([
    {
      name: "a PATH override that finds Homebrew git",
      host: { PATH: "/usr/bin:/bin" },
      env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
      spawned: true,
    },
    {
      name: "a PATH override that finds Apple's stub",
      host: { PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
      env: { PATH: "/usr/bin:/bin" },
      spawned: false,
    },
    {
      name: "a DEVELOPER_DIR override",
      host: { PATH: "/usr/bin:/bin" },
      env: { DEVELOPER_DIR: "/Applications/Xcode-beta.app/Contents/Developer" },
      spawned: true,
    },
    {
      name: "a DEVELOPER_DIR override that clears it",
      host: { PATH: "/usr/bin:/bin", DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" },
      env: { DEVELOPER_DIR: "" },
      spawned: false,
    },
  ])(
    "checks Apple's git stub against the command's own environment: $name",
    ({ host, env, spawned }) =>
      Effect.gen(function* () {
        const spawns: Array<string> = [];
        const spawner = makeSpawner((command) =>
          Effect.sync(() => {
            spawns.push(command.command);
            return makeHandle({ stdout: "true" });
          }),
        );

        const result = yield* runWith(spawner)({
          command: "git",
          args: ["rev-parse", "--is-inside-work-tree"],
          cwd: "/Users/dev/project",
          env,
        }).pipe(
          Effect.provideService(HostProcess.Platform, "darwin"),
          Effect.provideService(HostProcess.Environment, host),
          Effect.provideService(SpawnExecutableResolution, (_command, _platform, childEnv) =>
            childEnv.PATH?.startsWith("/opt/homebrew/bin")
              ? "/opt/homebrew/bin/git"
              : "/usr/bin/git",
          ),
          Effect.provideService(
            MacDeveloperDirectoryProbe,
            (childEnv) => (childEnv.DEVELOPER_DIR ?? "").trim() !== "",
          ),
          Effect.result,
        );

        expect(spawns).toEqual(spawned ? ["git"] : []);
        expect(result._tag).toBe(spawned ? "Success" : "Failure");
      }),
  );

  it.effect("fails when output exceeds max buffer in default mode", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() => Effect.succeed(makeHandle({ stdout: "x".repeat(2048) })));

      const error = yield* runWith(spawner)({
        command: "fake",
        args: ["stdout-bytes", "2048"],
        maxOutputBytes: 128,
      }).pipe(Effect.flip);

      expect(error._tag).toBe("ProcessOutputLimitError");
      if (error._tag !== "ProcessOutputLimitError") {
        return expect.fail("Expected ProcessOutputLimitError");
      }
      expect(error).toMatchObject({
        stream: "stdout",
        maxBytes: 128,
        observedBytes: 2048,
      });
      expect(error.message).toBe(
        "Process 'fake' stdout produced 2048 bytes, exceeding the 128 byte limit",
      );
    }),
  );

  it.effect("accepts output at the byte limit followed by an empty chunk", () =>
    Effect.gen(function* () {
      const output = new TextEncoder().encode("exactly");
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            stdout: Stream.make(output, new Uint8Array()),
          }),
        ),
      );

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["exact-limit"],
        maxOutputBytes: output.byteLength,
      });

      expect(result.stdout).toBe("exactly");
    }),
  );

  it.effect("fails fast on output limit before timeout for long-running output", () =>
    Effect.gen(function* () {
      const textChunk = "x".repeat(64);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            stdout: Stream.fromIterable(Array.from({ length: 10 }, () => textChunk)).pipe(
              Stream.encodeText,
            ),
            exitCode: Effect.never,
          }),
        ),
      );

      const error = yield* runWith(spawner)({
        command: "fake",
        args: ["spam-stdout"],
        maxOutputBytes: 128,
        timeout: "2 seconds",
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ProcessRunner.ProcessOutputLimitError);
    }),
  );

  it.effect("truncates output when outputMode is truncate", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() => Effect.succeed(makeHandle({ stdout: "x".repeat(2048) })));

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stdout-bytes", "2048"],
        maxOutputBytes: 128,
        outputMode: "truncate",
      });

      expect(result.code).toBe(0);
      expect(result.stdout.length).toBeLessThanOrEqual(128);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.stderrTruncated).toBe(false);
    }),
  );

  it.effect("writes stdin before waiting for exit", () =>
    Effect.gen(function* () {
      const stdinWritten = yield* Deferred.make<void>();
      const decoder = new TextDecoder();
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            stdout: "stdin payload",
            stdin: Sink.forEach((chunk: Uint8Array) => {
              const text = decoder.decode(chunk, { stream: true });
              return text.includes("stdin payload")
                ? Deferred.succeed(stdinWritten, undefined)
                : Effect.void;
            }),
            exitCode: Deferred.await(stdinWritten).pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
          }),
        ),
      );

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stdin-echo"],
        stdin: "stdin payload",
      });

      expect(result.stdout).toBe("stdin payload");
      expect(result.code).toBe(0);
    }),
  );

  it.effect("returns output for non-zero exit codes", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() => Effect.succeed(makeHandle({ stderr: "boom", code: 2 })));

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stderr-exit", "boom", "2"],
      });

      expect(result.code).toBe(2);
      expect(result.stderr).toBe("boom");
    }),
  );

  it.effect("fails on timeout", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            exitCode: Effect.never,
          }),
        ),
      );
      const errorFiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
        cwd: "/logical",
        spawnCwd: "/actual",
        timeout: "50 millis",
      }).pipe(Effect.flip, Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(50));
      const error = yield* Fiber.join(errorFiber);

      expect(error._tag).toBe("ProcessTimeoutError");
      if (error._tag !== "ProcessTimeoutError") {
        return expect.fail("Expected ProcessTimeoutError");
      }
      expect(error).toMatchObject({
        command: "fake",
        argumentCount: 1,
        cwd: "/logical",
        spawnCwd: "/actual",
        timeoutMs: 50,
      });
      expect(error.message).toBe("Process 'fake' in '/actual' timed out after 50ms");
    }),
  );

  it.effect("returns a synthetic timed out result when timeoutBehavior is timedOutResult", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            exitCode: Effect.never,
          }),
        ),
      );
      const resultFiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
        timeout: "50 millis",
        timeoutBehavior: "timedOutResult",
      }).pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(50));
      const result = yield* Fiber.join(resultFiber);

      expect(result).toMatchObject({
        stdout: "",
        stderr: "",
        code: null,
        timedOut: true,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    }),
  );
});

describe("isWindowsCommandNotFound", () => {
  it.effect("matches the localized German cmd.exe error text", () =>
    Effect.gen(function* () {
      const isCommandNotFound = yield* ProcessRunner.isWindowsCommandNotFound(
        1,
        "wird nicht als interner oder externer Befehl, betriebsfahiges Programm oder Batch-Datei erkannt",
      ).pipe(Effect.provideService(HostProcess.Platform, "win32"));
      expect(isCommandNotFound).toBe(true);
    }),
  );
});

describe("commandName", () => {
  it("drops the directory from POSIX and Windows paths", () => {
    expect(ProcessRunner.commandName("/Users/me/.local/bin/claude")).toBe("claude");
    expect(ProcessRunner.commandName("C:\\Program Files\\nodejs\\npx.cmd")).toBe("npx.cmd");
    expect(ProcessRunner.commandName("git")).toBe("git");
  });
});
