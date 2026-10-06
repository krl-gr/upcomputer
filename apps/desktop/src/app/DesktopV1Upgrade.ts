/**
 * Up.computer: the first start on an UpComputer V1 home moves its data onto v2
 * (see `apps/server/src/upcomputerCutover/V1Cutover.ts`). The server does the
 * work before it listens, so the desktop shows "Upgrading your data…" until
 * the v2 database exists, and turns a failed cutover into a choice to try
 * again or quit instead of a window that never opens.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { V1_CUTOVER_STATE_FILE, V1CutoverState } from "@t3tools/shared/upcomputerV1Cutover";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import type { DesktopBackendInstance } from "../backend/DesktopBackendManager.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopObservability from "./DesktopObservability.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("desktop-v1-upgrade");

const UPGRADING: DesktopWindow.DesktopSplashStatus = {
  label: "Upgrading your data…",
  busy: true,
};
const STOPPED: DesktopWindow.DesktopSplashStatus = {
  label: "Your data could not be upgraded",
  busy: false,
};
const POLL_INTERVAL = Duration.seconds(1);

const decodeState = Schema.decodeUnknownEffect(fromLenientJson(V1CutoverState));

export type V1Upgrade =
  | { readonly _tag: "none" }
  | { readonly _tag: "pending" }
  | { readonly _tag: "failed"; readonly state: V1CutoverState };

/** Whether this home still holds only V1 data, and how its cutover went. */
export const readV1Upgrade = Effect.fn("desktop.v1Upgrade.read")(function* (stateDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const { path } = yield* DesktopEnvironment.DesktopEnvironment;
  const exists = (name: string) =>
    fs.exists(path.join(stateDir, name)).pipe(Effect.orElseSucceed(() => false));
  if ((yield* exists("statev2.sqlite")) || !(yield* exists("state.sqlite"))) {
    return { _tag: "none" } satisfies V1Upgrade as V1Upgrade;
  }
  const state = yield* fs.readFileString(path.join(stateDir, V1_CUTOVER_STATE_FILE)).pipe(
    Effect.flatMap(decodeState),
    Effect.orElseSucceed(() => null),
  );
  return (state?.status === "failed"
    ? { _tag: "failed", state }
    : { _tag: "pending" }) satisfies V1Upgrade as V1Upgrade;
});

export function describeV1UpgradeFailure(state: V1CutoverState): string {
  return [
    `What stopped it: ${state.message ?? "unknown error"}.`,
    "Nothing was lost: your data is as it was before the update, and a backup was made.",
    ...(state.reportPath === undefined ? [] : [`Report: ${state.reportPath}`]),
    `Backup: ${state.backupDir}`,
  ].join("\n\n");
}

/** Asks until the person picks Try Again (true) or Quit (false). */
const askToRetry = Effect.fn("desktop.v1Upgrade.askToRetry")(function* (state: V1CutoverState) {
  const dialog = yield* ElectronDialog.ElectronDialog;
  const shell = yield* ElectronShell.ElectronShell;
  const detail = describeV1UpgradeFailure(state);
  while (true) {
    const { response } = yield* dialog.showMessageBox({
      type: "error",
      message: "Up.computer could not upgrade your data",
      detail,
      buttons: ["Try Again", "Copy Details", "Quit"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 1) {
      yield* shell.copyText(detail);
      continue;
    }
    return response === 0;
  }
});

/**
 * Starts the primary backend, showing the upgrade while the server moves V1
 * data. The home of a WSL primary lives in the distro, so it starts as is.
 */
export const startPrimaryBackend = Effect.fn("desktop.v1Upgrade.startPrimaryBackend")(function* (
  backend: DesktopBackendInstance,
  options: { readonly wslPrimary: boolean },
) {
  const { stateDir, path } = yield* DesktopEnvironment.DesktopEnvironment;
  const upgrade = options.wslPrimary ? { _tag: "none" as const } : yield* readV1Upgrade(stateDir);
  if (upgrade._tag === "none") return yield* backend.start;

  const fs = yield* FileSystem.FileSystem;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const electronApp = yield* ElectronApp.ElectronApp;

  // Until the v2 database exists: a failure stops the backend, which would
  // otherwise restart into the same recorded failure, and waits for the person.
  const supervise = Effect.gen(function* () {
    while (true) {
      const current = yield* readV1Upgrade(stateDir);
      if (current._tag === "none") return;
      if (current._tag === "failed") {
        yield* logWarning("V1 data cutover failed", { message: current.state.message });
        yield* backend.stop();
        yield* desktopWindow.showSplash(STOPPED);
        if (!(yield* askToRetry(current.state))) {
          yield* shutdown.request;
          yield* electronApp.quit;
          return;
        }
        yield* fs
          .remove(path.join(stateDir, V1_CUTOVER_STATE_FILE), { force: true })
          .pipe(Effect.ignore);
        yield* logInfo("retrying the V1 data cutover");
        yield* desktopWindow.showSplash(UPGRADING);
        yield* backend.start;
      }
      yield* Effect.sleep(POLL_INTERVAL);
    }
  });

  if (upgrade._tag === "pending") {
    yield* logInfo("upgrading V1 data on this start");
    yield* desktopWindow.showSplash(UPGRADING);
    yield* backend.start;
  }
  yield* Effect.forkScoped(supervise);
});
