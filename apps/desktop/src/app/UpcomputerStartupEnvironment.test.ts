import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { applyUpcomputerStartupEnvironment } from "./UpcomputerStartupEnvironment.ts";

const posixJoin = (...segments: string[]) => segments.join("/");

const makeEnvironment = (appVersion: string, env: Record<string, string | undefined>) =>
  DesktopEnvironment.DesktopEnvironment.pipe(
    Effect.provide(
      DesktopEnvironment.layer({
        dirname: "/repo/apps/desktop/dist-electron",
        homeDirectory: "/Users/alice",
        platform: "darwin",
        processArch: "arm64",
        appVersion,
        appPath: "/Applications/Up.computer (Alpha).app/Contents/Resources/app.asar",
        isPackaged: true,
        resourcesPath: "/Applications/Up.computer (Alpha).app/Contents/Resources",
        runningUnderArm64Translation: false,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
        ),
      ),
    ),
  );

describe("Up.computer desktop identity", () => {
  it.effect("keeps V1's home directory, app id and window name", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {};
      applyUpcomputerStartupEnvironment({
        env,
        appVersion: "0.0.46",
        homeDirectory: "/Users/alice",
        joinPath: posixJoin,
      });
      assert.deepStrictEqual(env, {});

      const environment = yield* makeEnvironment("0.0.46", env);
      assert.equal(environment.baseDir, "/Users/alice/.upcomputer");
      assert.equal(environment.stateDir, "/Users/alice/.upcomputer/userdata");
      assert.equal(environment.appUserModelId, "computer.up.upcomputer");
      assert.equal(environment.displayName, "Up.computer (Alpha)");
      assert.equal(environment.linuxWmClass, "upcomputer");
    }),
  );

  it.effect("maps UPCOMPUTER_ variables before the desktop reads its config", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        UPCOMPUTER_HOME: "/Volumes/work/.upcomputer",
        T3CODE_HOME: "/Users/alice/.t3",
      };
      applyUpcomputerStartupEnvironment({
        env,
        appVersion: "0.0.46",
        homeDirectory: "/Users/alice",
        joinPath: posixJoin,
      });

      const environment = yield* makeEnvironment("0.0.46", env);
      assert.equal(environment.baseDir, "/Volumes/work/.upcomputer");
    }),
  );

  it.effect("isolates a local test build from the Alpha app", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        T3CODE_HOME: "/Users/alice/.upcomputer",
        T3CODE_PORT: "3773",
        VITE_DEV_SERVER_URL: "http://localhost:5173",
      };
      applyUpcomputerStartupEnvironment({
        env,
        appVersion: "0.0.46-localtest.1",
        homeDirectory: "/Users/alice",
        joinPath: posixJoin,
      });
      assert.deepStrictEqual(env, {
        T3CODE_HOME: "/Users/alice/.upcomputer-local-test",
        T3CODE_DISABLE_AUTO_UPDATE: "true",
      });

      const environment = yield* makeEnvironment("0.0.46-localtest.1", env);
      assert.equal(environment.baseDir, "/Users/alice/.upcomputer-local-test");
      assert.equal(environment.stateDir, "/Users/alice/.upcomputer-local-test/userdata");
      assert.equal(environment.appUserModelId, "computer.up.upcomputer.localtest");
      assert.equal(environment.displayName, "UpComputer Local Test");
    }),
  );
});
