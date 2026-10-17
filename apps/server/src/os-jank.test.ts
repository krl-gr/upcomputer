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

import { fixPath, hydratePosixHome, resolveBaseDir } from "./os-jank.ts";
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

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
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

effectIt.effect.each(["darwin", "linux"] as const)(
  "keeps the prepared PATH and still hydrates HOME on %s",
  (platform) =>
    Effect.acquireUseRelease(
      Effect.sync(() => vi.spyOn(NodeChildProcess, "execFileSync")),
      (probe) =>
        Effect.gen(function* () {
          probe.mockImplementation(() => {
            throw new Error("The prepared environment must not launch another shell");
          });
          const env: NodeJS.ProcessEnv = { PATH: "/prepared/bin:/usr/bin" };

          yield* fixPath({ shellEnvironmentPrepared: true }).pipe(
            Effect.provideService(HostProcess.Platform, platform),
            Effect.provideService(HostProcess.Environment, env),
            Effect.provide(NodeServices.layer),
          );

          assert.equal(probe.mock.calls.length, 0);
          assert.equal(env.PATH, "/prepared/bin:/usr/bin");
          assert.equal(env.HOME, NodeOS.userInfo().homedir);
        }),
      (probe) => Effect.sync(() => probe.mockRestore()),
    ),
);

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
        assert.equal(env.PATH, `/opt/tools/bin:/usr/bin:${home}/.local/bin:${home}/.opencode/bin`);
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
        assert.equal(env.PATH, `/usr/bin:/bin:${home}/.local/bin:${home}/.opencode/bin`);

        const settings = decodeClaudeSettings({ binaryPath: "t3-test-claude" });
        const noCapabilities = () => Effect.succeed(undefined);
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

effectIt.effect("keeps the prepared Windows PATH without probing", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Prepared\\Bin;C:\\Windows" };
    const commands: string[] = [];

    yield* fixPath({ shellEnvironmentPrepared: true }).pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () => {
        throw new Error("The prepared environment must not launch another shell");
      }),
      Effect.provideService(CommandAvailability, (command) =>
        Effect.sync(() => {
          commands.push(command);
          return true;
        }),
      ),
      Effect.provide(NodeServices.layer),
    );

    assert.deepEqual(commands, []);
    assert.equal(env.PATH, "C:\\Prepared\\Bin;C:\\Windows");
  }),
);

effectIt.effect("replaces a Path-spelled Windows PATH instead of adding a second key", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { Path: "C:\\Windows" };

    yield* fixPath().pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provideService(HostProcess.Environment, env),
      Effect.provideService(WindowsShellEnvironment, () => ({ PATH: "C:\\Tools" })),
      Effect.provideService(CommandAvailability, () => Effect.succeed(true)),
      Effect.provide(NodeServices.layer),
    );

    assert.deepEqual(env, { PATH: "C:\\Tools;C:\\Windows" });
  }),
);
