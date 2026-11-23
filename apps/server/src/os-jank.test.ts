import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import { ClaudeSettings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  CommandAvailability,
  resolveCommandPath,
  WindowsShellEnvironment,
} from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Observe the existing synchronous shell probe without launching the user's login shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import { assert, it, vi } from "vite-plus/test";

import { fixPath, hydratePosixHome, refreshWindowsPath, resolveBaseDir } from "./os-jank.ts";
import { checkClaudeProviderStatus } from "./provider/ClaudeProvider.ts";

vi.mock("node:child_process", { spy: true });

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

effectIt.layer(NodeServices.layer)((it) => {
  it.effect("defaults the server home to Up.computer's ~/.upcomputer", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(
        yield* resolveBaseDir(undefined).pipe(
          Effect.provideService(HostProcess.HomeDirectory, "/home/tester"),
        ),
        path.join("/home/tester", ".upcomputer"),
      );
    }),
  );
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

effectIt.effect("hydrates PATH when the desktop handoff is absent", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        .mockReturnValue("__T3CODE_ENV_PATH_START__\n/opt/tools/bin\n__T3CODE_ENV_PATH_END__\n"),
    ),
    (probe) =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
          Effect.provide(NodeServices.layer),
        );

        assert.equal(probe.mock.calls.length, 1);
        const home = NodeOS.userInfo().homedir;
        assert.equal(
          env.PATH,
          `/opt/tools/bin:/usr/bin:${home}/.local/bin:${home}/.opencode/bin:${home}/.grok/bin`,
        );
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

// The native Claude and Codex installers write to ~/.local/bin and OpenCode's
// to ~/.opencode/bin, which a fresh login shell often lacks. The provider
// recheck after an onboarding install must find the CLI without restarting the
// server.
effectIt.effect("finds a CLI installed into ~/.local/bin or ~/.opencode/bin after startup", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        .mockReturnValue("__T3CODE_ENV_PATH_START__\n/usr/bin:/bin\n__T3CODE_ENV_PATH_END__\n"),
    ),
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-local-bin-" });
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", HOME: home, PATH: "/usr/bin:/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
        );
        assert.equal(
          env.PATH,
          `/usr/bin:/bin:${home}/.local/bin:${home}/.opencode/bin:${home}/.grok/bin`,
        );

        const settings = decodeClaudeSettings({ binaryPath: "t3-test-claude" });
        const noCapabilities = () => Effect.undefined;
        const before = yield* checkClaudeProviderStatus(settings, noCapabilities, env);
        assert.isFalse(before.installed);

        const binDirectory = path.join(home, ".local", "bin");
        const binary = path.join(binDirectory, "t3-test-claude");
        yield* fileSystem.makeDirectory(binDirectory, { recursive: true });
        yield* fileSystem.writeFileString(
          binary,
          `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.0 (Claude Code)"; else echo '{"loggedIn":false}'; fi\n`,
        );
        yield* fileSystem.chmod(binary, 0o755);

        const after = yield* checkClaudeProviderStatus(settings, noCapabilities, env);
        assert.isTrue(after.installed);
        assert.equal(after.version, "2.1.0");

        const openCode = path.join(home, ".opencode", "bin", "t3-test-opencode");
        yield* fileSystem.makeDirectory(path.dirname(openCode), { recursive: true });
        yield* fileSystem.writeFileString(openCode, "#!/bin/sh\n");
        yield* fileSystem.chmod(openCode, 0o755);
        assert.equal(yield* resolveCommandPath("t3-test-opencode", { env }), openCode);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

const timedOut = (file: string) =>
  Object.assign(new Error(`spawnSync ${file} ETIMEDOUT`), { code: "ETIMEDOUT" });

effectIt.effect("waits longer for a login shell that times out at startup", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi.spyOn(NodeChildProcess, "execFileSync").mockImplementation((file, _args, options) => {
        // This profile takes 8 seconds while the machine is under load.
        if ((options?.timeout ?? 0) < 8_000) throw timedOut(String(file));
        return "__T3CODE_ENV_PATH_START__\n/opt/tools/bin\n__T3CODE_ENV_PATH_END__\n";
      }),
    ),
    () =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", HOME: "/home/theo", PATH: "/usr/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
          Effect.provide(NodeServices.layer),
        );

        // UpComputer: the known CLI directories of HOME follow the login shell PATH.
        assert.equal(
          env.PATH,
          `/opt/tools/bin:/usr/bin:/home/theo/.local/bin:/home/theo/.opencode/bin:/home/theo/.grok/bin`,
        );
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("waits longer for only one hung login shell", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi.spyOn(NodeChildProcess, "execFileSync").mockImplementation((file) => {
        throw timedOut(String(file));
      }),
    ),
    (probe) =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", HOME: "/home/theo", PATH: "/usr/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
          Effect.provide(NodeServices.layer),
        );

        const timeouts = probe.mock.calls.map(([, , options]) => options?.timeout);
        assert.equal(timeouts.filter((timeout) => (timeout ?? 0) > 5_000).length, 1);
        assert.equal(
          env.PATH,
          `/usr/bin:/home/theo/.local/bin:/home/theo/.opencode/bin:/home/theo/.grok/bin`,
        );
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("keeps mise's PATH record with the login shell PATH", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        .mockReturnValue(
          [
            "__T3CODE_ENV_PATH_START__",
            "/home/me/.local/bin:/mise/installs/claude/latest:/mise/shims",
            "__T3CODE_ENV_PATH_END__",
            "__T3CODE_ENV___MISE_DIFF_START__",
            "mise-diff",
            "__T3CODE_ENV___MISE_DIFF_END__",
          ].join("\n"),
        ),
    ),
    () =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };

        yield* fixPath().pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, env),
          Effect.provide(NodeServices.layer),
        );

        assert.equal(env.__MISE_DIFF, "mise-diff");
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("hydrates a missing JAVA_HOME from the login shell and keeps an explicit one", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      vi
        .spyOn(NodeChildProcess, "execFileSync")
        .mockReturnValue(
          [
            "__T3CODE_ENV_PATH_START__",
            "/opt/homebrew/bin",
            "__T3CODE_ENV_PATH_END__",
            "__T3CODE_ENV_JAVA_HOME_START__",
            "/opt/homebrew/opt/openjdk@17",
            "__T3CODE_ENV_JAVA_HOME_END__",
          ].join("\n"),
        ),
    ),
    () =>
      Effect.gen(function* () {
        const missing: NodeJS.ProcessEnv = { SHELL: "/bin/zsh", PATH: "/usr/bin" };
        const explicit: NodeJS.ProcessEnv = {
          SHELL: "/bin/zsh",
          PATH: "/usr/bin",
          JAVA_HOME: "/custom/jdk",
        };

        for (const env of [missing, explicit]) {
          yield* fixPath().pipe(
            Effect.provideService(HostProcess.Platform, "darwin"),
            Effect.provideService(HostProcess.Environment, env),
            Effect.provide(NodeServices.layer),
          );
        }

        assert.equal(missing.JAVA_HOME, "/opt/homebrew/opt/openjdk@17");
        assert.equal(explicit.JAVA_HOME, "/custom/jdk");
      }),
    (probe) => Effect.sync(() => probe.mockRestore()),
  ),
);

effectIt.effect("replaces a Path-spelled Windows PATH instead of adding a second key", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { Path: "C:\\Windows" };

    yield* fixPath().pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () => Effect.succeed({ PATH: "C:\\Tools" })),
      Effect.provideService(CommandAvailability, () => Effect.succeed(true)),
      Effect.provide(NodeServices.layer),
    );

    assert.deepEqual(env, { PATH: "C:\\Tools;C:\\Windows" });
  }),
);

effectIt.effect("adds a directory an installer wrote to the registry after launch", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { Path: "C:\\Tools;C:\\Windows" };
    const installed = "C:\\Users\\me\\AppData\\Local\\cursor-agent";

    yield* refreshWindowsPath().pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () =>
        Effect.succeed({ PATH: `C:\\Windows;${installed}` }),
      ),
    );

    assert.deepEqual(env, { PATH: `C:\\Tools;C:\\Windows;${installed}` });
  }),
);
