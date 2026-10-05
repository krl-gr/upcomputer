import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Identity from "@t3tools/shared/upcomputerIdentity";

import { createBuildConfig, resolveDesktopProductName } from "./build-desktop-artifact.ts";

// Installed V1 apps auto-update into this build and keep their macOS
// permissions only while these values stay exactly as V1 shipped them. The
// literals are copied from V1 on purpose: do not derive them from the module.
const V1 = {
  appId: "computer.up.upcomputer",
  localTestAppId: "computer.up.upcomputer.localtest",
  productName: "Up.computer (Alpha)",
  nightlyProductName: "Up.computer (Nightly)",
  localTestProductName: "UpComputer Local Test",
  schemes: ["upcomputer", "upcomputer-dev"],
  homeDirectory: ".upcomputer",
  localTestHomeDirectory: ".upcomputer-local-test",
  executableName: "upcomputer",
  userDataDirectory: "Up.computer",
  developmentUserDataDirectory: "Up.computer (Dev)",
  updateRepository: "krl-gr/upcomputer",
} as const;

const releaseEnvironment = Layer.mergeAll(
  NodeServices.layer,
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: { GITHUB_REPOSITORY: V1.updateRepository } })),
);

it("keeps the V1 identity constants", () => {
  assert.equal(Identity.UPCOMPUTER_APP_ID, V1.appId);
  assert.equal(Identity.UPCOMPUTER_LOCAL_TEST_APP_ID, V1.localTestAppId);
  assert.equal(Identity.UPCOMPUTER_DESKTOP_PRODUCT_NAME, V1.productName);
  assert.equal(Identity.UPCOMPUTER_NIGHTLY_DESKTOP_PRODUCT_NAME, V1.nightlyProductName);
  assert.equal(Identity.UPCOMPUTER_LOCAL_TEST_APP_NAME, V1.localTestProductName);
  assert.deepStrictEqual(
    [Identity.UPCOMPUTER_PROTOCOL_SCHEME, Identity.UPCOMPUTER_DEVELOPMENT_PROTOCOL_SCHEME],
    V1.schemes,
  );
  assert.equal(Identity.UPCOMPUTER_HOME_DIRECTORY_NAME, V1.homeDirectory);
  assert.equal(Identity.UPCOMPUTER_LOCAL_TEST_HOME_DIRECTORY_NAME, V1.localTestHomeDirectory);
  assert.equal(Identity.UPCOMPUTER_EXECUTABLE_NAME, V1.executableName);
  assert.equal(Identity.UPCOMPUTER_USER_DATA_DIR_NAME, V1.userDataDirectory);
  assert.equal(Identity.UPCOMPUTER_DEVELOPMENT_USER_DATA_DIR_NAME, V1.developmentUserDataDirectory);
  assert.equal(Identity.UPCOMPUTER_UPDATE_REPOSITORY, V1.updateRepository);
});

it("names packaged builds as V1 did", () => {
  assert.equal(resolveDesktopProductName("0.0.46"), V1.productName);
  assert.equal(resolveDesktopProductName("0.0.46-nightly.20261005.1"), V1.nightlyProductName);
  assert.equal(resolveDesktopProductName("0.0.46-localtest.1"), V1.localTestProductName);
});

it.effect("packages releases with the V1 app id, schemes and update feed", () =>
  Effect.gen(function* () {
    for (const [platform, target] of [
      ["mac", "dmg"],
      ["linux", "AppImage"],
      ["win", "nsis"],
    ] as const) {
      const config = yield* createBuildConfig(
        platform,
        target,
        "0.0.46",
        false,
        false,
        undefined,
        undefined,
      );
      assert.equal(config.appId, V1.appId);
      assert.equal(config.productName, V1.productName);
      assert.deepStrictEqual(config.publish, [
        { provider: "github", owner: "krl-gr", repo: "upcomputer", releaseType: "release" },
      ]);
    }

    const mac = yield* createBuildConfig(
      "mac",
      "dmg",
      "0.0.46",
      false,
      false,
      undefined,
      undefined,
    );
    assert.deepStrictEqual((mac.mac as Record<string, unknown>).protocols, [
      { name: "Up.computer", schemes: V1.schemes },
    ]);
    const linux = yield* createBuildConfig(
      "linux",
      "AppImage",
      "0.0.46",
      false,
      false,
      undefined,
      undefined,
    );
    const linuxConfig = linux.linux as Record<string, unknown>;
    assert.equal(linuxConfig.executableName, V1.executableName);
    assert.deepStrictEqual(linuxConfig.protocols, [{ name: "Up.computer", schemes: V1.schemes }]);

    const nightly = yield* createBuildConfig(
      "mac",
      "dmg",
      "0.0.46-nightly.20261005.1",
      false,
      false,
      undefined,
      undefined,
    );
    assert.equal(nightly.appId, V1.appId);
    assert.deepStrictEqual(nightly.publish, [
      {
        provider: "github",
        owner: "krl-gr",
        repo: "upcomputer",
        releaseType: "prerelease",
        channel: "nightly",
      },
    ]);
  }).pipe(Effect.provide(releaseEnvironment)),
);

it.effect("keeps local test builds off the Alpha bundle id, schemes and update feed", () =>
  Effect.gen(function* () {
    const config = yield* createBuildConfig(
      "mac",
      "dmg",
      "0.0.46-localtest.1",
      false,
      false,
      undefined,
      undefined,
    );
    assert.equal(config.appId, V1.localTestAppId);
    assert.equal(config.productName, V1.localTestProductName);
    assert.notProperty(config, "publish");
    assert.deepStrictEqual((config.mac as Record<string, unknown>).protocols, []);
  }).pipe(Effect.provide(releaseEnvironment)),
);
