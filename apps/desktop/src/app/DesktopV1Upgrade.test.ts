// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { V1CutoverState } from "@t3tools/shared/upcomputerV1Cutover";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import type { DesktopBackendInstance } from "../backend/DesktopBackendManager.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopV1Upgrade from "./DesktopV1Upgrade.ts";

const failedState: V1CutoverState = {
  status: "failed",
  startedAt: "2026-10-06T08:00:00.000Z",
  backupDir: "/home/userdata/v1-cutover-backup-20261006T080000Z",
  reportPath: "/home/userdata/v1-cutover-report-20261006T080000Z.md",
  message: "1 check(s) differ (messages)",
};

function makeStateDir(files: Record<string, string>) {
  const stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "desktop-v1-upgrade-"));
  for (const [name, text] of Object.entries(files)) {
    NodeFS.writeFileSync(NodePath.join(stateDir, name), text);
  }
  return stateDir;
}

/** The desktop around the upgrade, recording what it was asked to do. */
function makeHarness(stateDir: string, dialogResponses: Array<number>) {
  const events: Array<string> = [];
  return Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const quit = yield* Deferred.make<void>();
    const path = yield* Path.Path;
    const backend = {
      start: Effect.sync(() => events.push("start")).pipe(
        Effect.andThen(Deferred.succeed(started, undefined)),
        Effect.asVoid,
      ),
      stop: () => Effect.sync(() => void events.push("stop")),
    } as unknown as DesktopBackendInstance;
    const layer = Layer.mergeAll(
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        stateDir,
        path,
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
      Layer.succeed(DesktopWindow.DesktopWindow, {
        showSplash: (status: DesktopWindow.DesktopSplashStatus) =>
          Effect.sync(() => void events.push(`splash: ${status.label}`)),
      } as unknown as DesktopWindow.DesktopWindow["Service"]),
      Layer.succeed(ElectronDialog.ElectronDialog, {
        showMessageBox: () =>
          Effect.sync(() => {
            events.push("dialog");
            return { response: dialogResponses.shift() ?? 2, checkboxChecked: false };
          }),
      } as unknown as ElectronDialog.ElectronDialog["Service"]),
      Layer.succeed(ElectronShell.ElectronShell, {
        copyText: (text: string) => Effect.sync(() => void events.push(`copy: ${text}`)),
      } as unknown as ElectronShell.ElectronShell["Service"]),
      Layer.succeed(ElectronApp.ElectronApp, {
        quit: Effect.sync(() => events.push("quit")).pipe(
          Effect.andThen(Deferred.succeed(quit, undefined)),
          Effect.asVoid,
        ),
      } as unknown as ElectronApp.ElectronApp["Service"]),
      DesktopShutdown.layer,
    );
    return { events, backend, started, quit, layer };
  });
}

describe("DesktopV1Upgrade", () => {
  it.effect("tells a V1 home that still needs its upgrade from one that is done", () => {
    const pending = makeStateDir({ "state.sqlite": "" });
    const failed = makeStateDir({
      "state.sqlite": "",
      "v1-cutover.json": JSON.stringify(failedState),
    });
    const done = makeStateDir({ "state.sqlite": "", "statev2.sqlite": "" });
    const fresh = makeStateDir({});
    return Effect.gen(function* () {
      const path = yield* Path.Path;
      const read = (stateDir: string) =>
        DesktopV1Upgrade.readV1Upgrade(stateDir).pipe(
          Effect.provideService(DesktopEnvironment.DesktopEnvironment, {
            path,
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
        );
      assert.equal((yield* read(pending))._tag, "pending");
      assert.deepStrictEqual(yield* read(failed), { _tag: "failed", state: failedState });
      assert.equal((yield* read(done))._tag, "none");
      assert.equal((yield* read(fresh))._tag, "none");
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.ensuring(
        Effect.sync(() => {
          for (const dir of [pending, failed, done, fresh]) {
            NodeFS.rmSync(dir, { recursive: true, force: true });
          }
        }),
      ),
    );
  });

  it.effect("after a failed upgrade, Quit leaves the backend stopped and the record kept", () => {
    const stateDir = makeStateDir({
      "state.sqlite": "",
      "v1-cutover.json": JSON.stringify(failedState),
    });
    return Effect.gen(function* () {
      const harness = yield* makeHarness(stateDir, [2]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* DesktopV1Upgrade.startPrimaryBackend(harness.backend, { wslPrimary: false });
          yield* Deferred.await(harness.quit);
        }).pipe(Effect.provide(harness.layer)),
      );
      assert.deepStrictEqual(harness.events, [
        "stop",
        "splash: Your data could not be upgraded",
        "dialog",
        "quit",
      ]);
      assert.isTrue(NodeFS.existsSync(NodePath.join(stateDir, "v1-cutover.json")));
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(stateDir, { recursive: true, force: true }))),
    );
  });

  it.effect("after a failed upgrade, Try Again clears the record and starts the backend", () => {
    const stateDir = makeStateDir({
      "state.sqlite": "",
      "v1-cutover.json": JSON.stringify(failedState),
    });
    return Effect.gen(function* () {
      // Copy Details first, then Try Again.
      const harness = yield* makeHarness(stateDir, [1, 0]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* DesktopV1Upgrade.startPrimaryBackend(harness.backend, { wslPrimary: false });
          yield* Deferred.await(harness.started);
        }).pipe(Effect.provide(harness.layer)),
      );
      const detail = DesktopV1Upgrade.describeV1UpgradeFailure(failedState);
      assert.include(detail, `Report: ${failedState.reportPath}`);
      assert.include(detail, `Backup: ${failedState.backupDir}`);
      assert.deepStrictEqual(harness.events, [
        "stop",
        "splash: Your data could not be upgraded",
        "dialog",
        `copy: ${detail}`,
        "dialog",
        "splash: Upgrading your data…",
        "start",
      ]);
      assert.isFalse(NodeFS.existsSync(NodePath.join(stateDir, "v1-cutover.json")));
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(stateDir, { recursive: true, force: true }))),
    );
  });

  it.effect("shows the upgrade while the backend moves V1 data", () => {
    const stateDir = makeStateDir({ "state.sqlite": "" });
    return Effect.gen(function* () {
      const harness = yield* makeHarness(stateDir, []);
      yield* Effect.scoped(
        DesktopV1Upgrade.startPrimaryBackend(harness.backend, { wslPrimary: false }).pipe(
          Effect.provide(harness.layer),
        ),
      );
      assert.deepStrictEqual(harness.events, ["splash: Upgrading your data…", "start"]);
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(stateDir, { recursive: true, force: true }))),
    );
  });
});
