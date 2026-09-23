// Opt-in guest-only fixture. Never run this against a working OS user/profile.
import * as NodeChildProcess from "node:child_process";
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Electron from "electron";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ConnectionCatalogDocument } from "@upcomputer/client-runtime/platform";
import * as Store from "../apps/desktop/src/app/DesktopConnectionCatalogStore.ts";
import * as Environment from "../apps/desktop/src/app/DesktopEnvironment.ts";
import * as Config from "../apps/desktop/src/app/DesktopConfig.ts";
import * as Saved from "../apps/desktop/src/settings/DesktopSavedEnvironments.ts";
import { configureLegacyEncryptionIdentity } from "../apps/desktop/src/app/legacyEncryptionIdentity.ts";
import * as SafeStorage from "../apps/desktop/src/electron/ElectronSafeStorage.ts";

const decodeCatalog = Schema.decodeEffect(Schema.fromJsonString(ConnectionCatalogDocument));

function fixtureRoot() {
  // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Native fixture must reject other operating systems before touching OS encryption.
  NodeAssert.equal(NodeOS.platform(), "darwin");
  NodeAssert.match(
    NodeChildProcess.execFileSync("/usr/sbin/sysctl", ["-n", "hw.model"], {
      encoding: "utf8",
    }).trim(),
    /^VirtualMac/,
  );
  NodeAssert.equal(process.env.UPCOMPUTER_NATIVE_FIXTURE, "tart-profile-v1");
  const root = NodePath.join(NodeOS.homedir(), "UpComputer-Native-Profile-Fixture");
  NodeAssert.equal(
    NodeFS.readFileSync(NodePath.join(root, ".fixture"), "utf8"),
    "synthetic-only\n",
  );
  return NodeFS.realpathSync(root);
}

function layer(baseDir) {
  const environment = Environment.layer({
    dirname: "/fixture/app",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "0.0.31",
    appPath: "/fixture/app",
    isPackaged: true,
    resourcesPath: "/fixture/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, Config.layerTest({ UPCOMPUTER_HOME: baseDir })),
    ),
  );
  const dependencies = Layer.mergeAll(environment, SafeStorage.layer, NodeServices.layer);
  return Store.layer.pipe(
    Layer.provideMerge(Saved.layer.pipe(Layer.provideMerge(dependencies))),
    Layer.provideMerge(dependencies),
  );
}

export async function run({ directory, action, generation = 1 }) {
  const root = fixtureRoot();
  NodeAssert.match(directory, /^(source|candidate|prepared|restore|preserved-newer|corrupt)$/);
  NodeAssert.ok(["write", "read", "reject-corrupt", "reject-identity"].includes(action));
  NodeAssert.ok(generation === 1 || generation === 2);
  const base =
    directory === "prepared"
      ? NodePath.join(root, "migration", "candidate", "backend")
      : NodePath.join(root, directory);
  if (action === "write") NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  NodeAssert.equal(NodeFS.realpathSync(base), base);
  await Electron.app.whenReady();
  NodeAssert.equal(Electron.safeStorage.isEncryptionAvailable(), true, "OS encryption unavailable");
  const catalog = JSON.stringify({
    schemaVersion: 1,
    targets: [
      {
        _tag: "RelayConnectionTarget",
        environmentId: "synthetic-native-target",
        label: `Native fixture generation ${generation}`,
      },
    ],
    profiles: [],
    credentials: [],
    remoteDpopTokens: [],
  });
  const file = NodePath.join(base, "userdata", "connection-catalog.json");
  const before = NodeFS.existsSync(file) ? NodeFS.readFileSync(file) : null;
  // This standalone native test explicitly owns its Effect runtime, not app startup.
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* decodeCatalog(catalog);
      const store = yield* Store.DesktopConnectionCatalogStore;
      if (action === "write") NodeAssert.equal(yield* store.set(catalog), true);
      if (action === "reject-identity") {
        const error = yield* Effect.flip(store.get);
        NodeAssert.equal(error._tag, "DesktopConnectionCatalogStoreProtectionError");
        NodeAssert.equal(error.operation, "decrypt-catalog");
      } else if (action === "reject-corrupt") {
        const error = yield* Effect.flip(store.get);
        NodeAssert.equal(error._tag, "DesktopConnectionCatalogStoreProtectionError");
        NodeAssert.equal(error.operation, "decrypt-catalog");
      } else {
        const result = yield* store.get;
        NodeAssert.ok(Option.isSome(result));
        NodeAssert.equal(result.value, catalog, "Catalog did not survive native decrypt");
      }
    }).pipe(Effect.provide(layer(base)), Effect.scoped),
  );
  const after = NodeFS.readFileSync(file);
  if (action !== "write")
    NodeAssert.deepEqual(after, before, "Read/validation mutated the catalog");
  if (!["reject-corrupt", "reject-identity"].includes(action)) {
    const envelope = JSON.parse(after.toString());
    NodeAssert.equal(envelope.version, 1);
    NodeAssert.equal(typeof envelope.encryptedCatalog, "string");
    NodeAssert.equal(after.includes(Buffer.from(catalog)), false, "Plaintext persisted");
  }
  return {
    passed: true,
    action,
    directory,
    generation,
    appName: Electron.app.getName(),
    appVersion: Electron.app.getVersion(),
    electron: process.versions.electron,
    encryptionAvailable: true,
  };
}

export function configureCompatibility() {
  fixtureRoot();
  configureLegacyEncryptionIdentity(Electron.app);
  return { name: Electron.app.getName(), ready: Electron.app.isReady() };
}
