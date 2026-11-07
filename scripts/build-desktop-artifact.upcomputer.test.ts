import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { createBuildConfig } from "./build-desktop-artifact.ts";

it.layer(NodeServices.layer)("build-desktop-artifact (Up.computer)", (it) => {
  it.effect("Windows builds ship no prepared server bytecode; macOS builds still do", () =>
    Effect.gen(function* () {
      const win = yield* createBuildConfig(
        "win",
        "nsis",
        "1.2.3",
        false,
        false,
        undefined,
        undefined,
      );
      assert.notProperty(win, "afterPack");

      const mac = yield* createBuildConfig(
        "mac",
        "dmg",
        "1.2.3",
        false,
        false,
        undefined,
        undefined,
      );
      assert.match(String(mac.afterPack), /[\\/]scripts[\\/]prepare-server-compile-cache\.cjs$/);
    }).pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
    ),
  );
});
