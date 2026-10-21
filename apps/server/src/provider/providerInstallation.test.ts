import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstallState,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as CodexInstallation from "./CodexInstallation.ts";
import * as AntigravityInstallation from "./AntigravityInstallation.ts";
import * as OpenCodeInstallation from "./OpenCodeInstallation.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import { makeProviderInstallation } from "./providerInstallation.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const instanceId = ProviderInstanceId.make("antigravity");
const driver = ProviderDriverKind.make("antigravity");
const state: ProviderInstallState = {
  driver,
  operationId: null,
  phase: "idle",
  downloadedBytes: 0,
  totalBytes: null,
  version: null,
  installedVersion: null,
  canRemove: false,
  message: null,
};

function instance(kind = driver, id = instanceId): ProviderInstance {
  return {
    instanceId: id,
    driverKind: kind,
    enabled: false,
    displayName: undefined,
    continuationIdentity: { driverKind: kind, continuationKey: instanceId },
    get orchestrationAdapter(): never {
      throw new Error("Installation must not start a provider session.");
    },
    get snapshot(): never {
      throw new Error("Installation routing must not probe the provider.");
    },
    get textGeneration(): never {
      throw new Error("Installation must not generate text.");
    },
  };
}

const makeHarness = Effect.fn("providerInstallation.test.makeHarness")(function* (
  input: {
    instance?: ProviderInstance;
    settings?: Parameters<typeof ServerSettings.layerTest>[0];
  } = {},
) {
  const calls: string[] = [];
  let protectedPaths: ReadonlyArray<string> = [];
  const configured = input.instance ?? instance();
  const router = yield* makeProviderInstallation().pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerSettings.layerTest(input.settings),
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: (id) =>
            Effect.succeed(id === configured.instanceId ? configured : undefined),
          listInstances: Effect.succeed([configured]),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          refreshInstance: () =>
            Effect.sync(() => {
              calls.push("refresh");
              return [];
            }),
        }),
        Layer.mock(CodexInstallation.CodexInstallation)({
          managedDirectory: "/unused-managed-codex",
          start: Effect.sync(() => {
            calls.push("codex-start");
            return { ...state, driver: ProviderDriverKind.make("codex") };
          }),
          cancel: () =>
            Effect.sync(() => {
              calls.push("codex-cancel");
              return { ...state, driver: ProviderDriverKind.make("codex") };
            }),
          state: Effect.succeed({ ...state, driver: ProviderDriverKind.make("codex") }),
          changes: Stream.succeed({ ...state, driver: ProviderDriverKind.make("codex") }),
          remove: (paths) =>
            Effect.sync(() => {
              protectedPaths = paths ?? [];
              calls.push("codex-remove");
            }),
        }),
        Layer.mock(OpenCodeInstallation.OpenCodeInstallation)({
          managedDirectory: "/managed-opencode",
          start: Effect.sync(() => {
            calls.push("opencode-start");
            return { ...state, driver: ProviderDriverKind.make("opencode") };
          }),
          cancel: () =>
            Effect.sync(() => {
              calls.push("opencode-cancel");
              return { ...state, driver: ProviderDriverKind.make("opencode") };
            }),
          state: Effect.succeed({ ...state, driver: ProviderDriverKind.make("opencode") }),
          changes: Stream.succeed({ ...state, driver: ProviderDriverKind.make("opencode") }),
        }),
        Layer.mock(AntigravityInstallation.AntigravityInstallation)({
          managedDirectory: "/unused-managed-runtime",
          start: Effect.sync(() => {
            calls.push("start");
            return state;
          }),
          cancel: () =>
            Effect.sync(() => {
              calls.push("cancel");
              return state;
            }),
          state: Effect.succeed(state),
          changes: Stream.succeed(state),
          remove: (paths) =>
            Effect.sync(() => {
              protectedPaths = paths ?? [];
              calls.push("remove");
            }),
        }),
      ),
    ),
  );
  return { router, calls, protectedPaths: () => protectedPaths };
});

describe("provider installation routing", () => {
  it.effect("allows explicit installation while the provider is disabled", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.router.start({ instanceId });
      assert.deepEqual(harness.calls, ["start"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects another driver and unknown instances before installation", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ instance: instance(ProviderDriverKind.make("codex")) });
      const wrongDriver = yield* Effect.flip(harness.router.start({ instanceId }));
      const missing = yield* Effect.flip(
        harness.router.start({ instanceId: ProviderInstanceId.make("missing") }),
      );
      assert.equal(wrongDriver._tag, "ProviderSetupError");
      assert.equal(missing._tag, "ProviderSetupError");
      assert.deepEqual(harness.calls, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps external installs manual without hiding shared install status", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: {
          providerInstances: {
            [ProviderInstanceId.make("antigravity")]: {
              driver: ProviderDriverKind.make("antigravity"),
              config: { binaryPath: "/external/agy" },
            },
          },
        },
      });
      const start = yield* Effect.flip(harness.router.start({ instanceId }));
      const remove = yield* Effect.flip(harness.router.remove({ instanceId }));
      assert.include(start.detail, "custom executable");
      assert.include(remove.detail, "custom executable");
      const observed = yield* Stream.runCollect(harness.router.subscribe({ instanceId }));
      assert.deepEqual(Array.from(observed), [state]);
      assert.deepEqual(harness.calls, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("routes a managed Codex instance through its own installer and refreshes removal", () =>
    Effect.gen(function* () {
      const codexId = ProviderInstanceId.make("codex");
      const harness = yield* makeHarness({
        instance: instance(ProviderDriverKind.make("codex"), codexId),
        settings: {
          providerInstances: {
            [ProviderInstanceId.make("codex")]: {
              driver: ProviderDriverKind.make("codex"),
              config: { setupMode: "managed" },
            },
          },
        },
      });
      assert.equal((yield* harness.router.start({ instanceId: codexId })).driver, "codex");
      yield* harness.router.cancel({ instanceId: codexId, operationId: "operation" });
      const observed = yield* Stream.runCollect(harness.router.subscribe({ instanceId: codexId }));
      assert.equal(Array.from(observed)[0]?.driver, "codex");
      yield* harness.router.remove({ instanceId: codexId });
      assert.deepEqual(harness.calls, ["codex-start", "codex-cancel", "codex-remove", "refresh"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("routes the default OpenCode instance to its installer, without removal", () =>
    Effect.gen(function* () {
      const openCodeId = ProviderInstanceId.make("opencode");
      const harness = yield* makeHarness({
        instance: instance(ProviderDriverKind.make("opencode"), openCodeId),
      });
      assert.equal((yield* harness.router.start({ instanceId: openCodeId })).driver, "opencode");
      yield* harness.router.cancel({ instanceId: openCodeId, operationId: "operation" });
      const observed = yield* Stream.runCollect(
        harness.router.subscribe({ instanceId: openCodeId }),
      );
      assert.equal(Array.from(observed)[0]?.driver, "opencode");
      const remove = yield* Effect.flip(harness.router.remove({ instanceId: openCodeId }));
      assert.equal(remove._tag, "ProviderSetupError");
      assert.deepEqual(harness.calls, ["opencode-start", "opencode-cancel"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves an OpenCode instance with its own executable alone", () =>
    Effect.gen(function* () {
      const openCodeId = ProviderInstanceId.make("opencode");
      const harness = yield* makeHarness({
        instance: instance(ProviderDriverKind.make("opencode"), openCodeId),
        settings: {
          providerInstances: {
            [openCodeId]: {
              driver: ProviderDriverKind.make("opencode"),
              config: { binaryPath: "/usr/local/bin/opencode" },
            },
          },
        },
      });
      assert.include(
        (yield* Effect.flip(harness.router.start({ instanceId: openCodeId }))).detail,
        "custom executable",
      );
      const other = ProviderInstanceId.make("opencode-work");
      const second = yield* makeHarness({
        instance: instance(ProviderDriverKind.make("opencode"), other),
      });
      assert.equal(
        (yield* Effect.flip(second.router.start({ instanceId: other })))._tag,
        "ProviderSetupError",
      );
      assert.deepEqual([...harness.calls, ...second.calls], []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps native Codex installation outside managed setup", () =>
    Effect.gen(function* () {
      const codexId = ProviderInstanceId.make("codex");
      const harness = yield* makeHarness({
        instance: instance(ProviderDriverKind.make("codex"), codexId),
        settings: {
          providerInstances: {
            [ProviderInstanceId.make("codex")]: {
              driver: ProviderDriverKind.make("codex"),
              config: { setupMode: "existing" },
            },
          },
        },
      });
      assert.include(
        (yield* Effect.flip(harness.router.start({ instanceId: codexId }))).detail,
        "Choose managed setup",
      );
      assert.deepEqual(harness.calls, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("protects another instance's binary found through its own PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const platform = yield* HostProcess.Platform;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-provider-install-route-" });
      const binary = platform === "win32" ? "agy-test.exe" : "agy-test";
      const executable = path.join(directory, binary);
      yield* fs.writeFileString(executable, "test");
      yield* fs.chmod(executable, 0o755);
      const other = ProviderInstanceId.make("antigravity-work");
      const harness = yield* makeHarness({
        settings: {
          providerInstances: {
            [other]: {
              driver,
              config: { binaryPath: binary },
              environment: [{ name: "PATH", value: directory, sensitive: false }],
            },
          },
        },
      });
      yield* harness.router.remove({ instanceId });
      assert.include(harness.protectedPaths(), executable);
      assert.deepEqual(harness.calls, ["remove", "refresh"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps only the configured path when another instance's binary is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-provider-install-route-" });
      const binaryPath = path.join(directory, "missing");
      const harness = yield* makeHarness({
        settings: {
          providerInstances: {
            [ProviderInstanceId.make("antigravity-work")]: {
              driver,
              config: { binaryPath },
            },
          },
        },
      });
      yield* harness.router.remove({ instanceId });
      assert.deepEqual(harness.protectedPaths(), [binaryPath]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
