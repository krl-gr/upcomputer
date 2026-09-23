import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/UpComputer.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/UpComputer.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))));

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("ignores legacy HOME and does not probe existing old profiles", () =>
    Effect.gen(function* () {
      const environment = yield* DesktopEnvironment.DesktopEnvironment.pipe(
        Effect.provide(
          DesktopEnvironment.layer(defaultInput).pipe(
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                DesktopConfig.layerTest({ T3CODE_HOME: "/old-live-profile" }),
                FileSystem.layerNoop({
                  exists: () => Effect.die("Unexpected old profile discovery"),
                }),
              ),
            ),
          ),
        ),
      );
      assert.equal(environment.baseDir, "/Users/alice/.upcomputer");
      assert.equal(environment.userDataDirName, "Up.computer");
    }),
  );
  it.effect(
    "isolates packaged local-test identity even with production environment overrides",
    () =>
      Effect.gen(function* () {
        const environment = yield* makeEnvironment(
          { isPackaged: true, appVersion: "0.0.31-localtest.1" },
          { UPCOMPUTER_HOME: "/production", T3CODE_HOME: "/legacy", UPCOMPUTER_PORT: "3773" },
        );
        assert.equal(environment.baseDir, "/Users/alice/.upcomputer-local-test");
        assert.equal(environment.stateDir, "/Users/alice/.upcomputer-local-test/userdata");
        assert.equal(environment.userDataDirName, "UpComputer Local Test");
        assert.equal(environment.displayName, "UpComputer Local Test");
        assert.equal(environment.appUserModelId, "computer.up.upcomputer.localtest");
        assert.deepEqual(environment.configuredBackendPort, Option.none());
      }),
  );
  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          UPCOMPUTER_HOME: " /tmp/t3 ",
          UPCOMPUTER_COMMIT_HASH: " 0123456789abcdef ",
          UPCOMPUTER_PORT: "4949",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          UPCOMPUTER_DEV_REMOTE_SERVER_ENTRY_PATH: " /remote/server.mjs ",
          UPCOMPUTER_OTLP_TRACES_URL: " http://127.0.0.1:4318/v1/traces ",
          UPCOMPUTER_OTLP_EXPORT_INTERVAL_MS: "2500",
        },
      );

      assert.equal(environment.isDevelopment, true);
      assert.equal(environment.appDataDirectory, "/Users/alice/Library/Application Support");
      assert.equal(environment.baseDir, "/tmp/t3");
      assert.equal(environment.stateDir, "/tmp/t3/userdata");
      assert.equal(environment.desktopSettingsPath, "/tmp/t3/userdata/desktop-settings.json");
      assert.equal(environment.clientSettingsPath, "/tmp/t3/userdata/client-settings.json");
      assert.equal(
        environment.savedEnvironmentRegistryPath,
        "/tmp/t3/userdata/saved-environments.json",
      );
      assert.equal(environment.serverSettingsPath, "/tmp/t3/userdata/settings.json");
      assert.equal(environment.logDir, "/tmp/t3/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/t3/userdata/browser-artifacts");
      assert.equal(environment.rootDir, "/repo");
      assert.equal(environment.appRoot, "/repo");
      assert.equal(environment.backendEntryPath, "/repo/apps/server/dist/bin.mjs");
      assert.equal(environment.backendCwd, "/repo");
      assert.equal(environment.appUserModelId, "computer.up.upcomputer.dev");
      assert.equal(environment.linuxWmClass, "upcomputer-dev");
      assert.deepEqual(
        Option.map(environment.devServerUrl, (url) => url.href),
        Option.some("http://localhost:5173/"),
      );
      assert.deepEqual(environment.devRemoteServerEntryPath, Option.some("/remote/server.mjs"));
      assert.deepEqual(environment.configuredBackendPort, Option.some(4949));
      assert.deepEqual(environment.commitHashOverride, Option.some("0123456789abcdef"));
      assert.deepEqual(environment.otlpTracesUrl, Option.some("http://127.0.0.1:4318/v1/traces"));
      assert.equal(environment.otlpExportIntervalMs, 2500);
    }),
  );

  it.effect("stores production state under userdata in an explicit home", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          UPCOMPUTER_HOME: "/tmp/t3",
        },
      );

      assert.equal(environment.isDevelopment, false);
      assert.equal(environment.stateDir, "/tmp/t3/userdata");
      assert.equal(environment.logDir, "/tmp/t3/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/t3/userdata/browser-artifacts");
      assert.equal(environment.serverSettingsPath, "/tmp/t3/userdata/settings.json");
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      // New defaults never discover or adopt an existing ~/.t3.
      assert.equal(development.stateDir, "/Users/alice/.upcomputer/dev");
      assert.equal(production.stateDir, "/Users/alice/.upcomputer/userdata");
    }),
  );

  it.effect("uses a configured app user model id override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          UPCOMPUTER_DESKTOP_APP_USER_MODEL_ID: " com.t3tools.t3code.dev.local ",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      );

      assert.equal(environment.appUserModelId, "com.t3tools.t3code.dev.local");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
        Option.some("/Users/alice/project"),
      );
    }),
  );
});
