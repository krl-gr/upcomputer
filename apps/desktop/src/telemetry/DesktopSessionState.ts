// @effect-diagnostics nodeBuiltinImport:off - Windows may end the process as soon as a session-end listener returns, so the write is synchronous
import * as NodeFS from "node:fs";

import {
  DESKTOP_SESSION_STATE_FILE,
  DesktopSessionState as DesktopSessionStateSchema,
  type DesktopSessionStateEntry,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopManagedPolicy from "../app/DesktopManagedPolicy.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";

const encodeState = Schema.encodeSync(Schema.fromJsonString(DesktopSessionStateSchema));
// Config.Boolean's false values, which the backend reads for the same opt-out.
const TELEMETRY_DISABLED = /^(?:false|no|off|0|n)$/i;
// Antivirus can hold the file open for a moment; a session-end listener cannot wait.
const WRITE_ATTEMPTS = 3;

/**
 * The app session's last lifecycle change, kept beside the backend's session
 * marker. A backend that died or was killed cannot say why; its next start
 * reads this file instead.
 */
export class DesktopSessionState extends Context.Service<
  DesktopSessionState,
  {
    /** One per app launch, so backend restarts stay in the same telemetry session. */
    readonly sessionId: string;
    /**
     * Writes synchronously and never throws, so OS event listeners can call it.
     * After os_shutdown it writes nothing more: the OS then kills the renderer
     * and the backend too, and that is not a crash.
     */
    readonly recordUnsafe: (last: DesktopSessionStateEntry) => void;
    /** Records running if `state` is still the last one, as when the main window reloads. */
    readonly recoveredUnsafe: (state: DesktopSessionStateEntry["state"]) => void;
  }
>()("@t3tools/desktop/telemetry/DesktopSessionState") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const clock = yield* Clock.Clock;
  const env = yield* HostProcess.Environment;
  const sessionId = yield* (yield* SecureRandom.SecureRandom).uuidV4();
  const filePath = environment.path.join(environment.stateDir, DESKTOP_SESSION_STATE_FILE);
  // A policy that cannot be used keeps the backend from starting, so nothing would read the file.
  const policyAllows = yield* (yield* DesktopManagedPolicy.DesktopManagedPolicy).read.pipe(
    Effect.map((found) => found?.document.limits?.telemetry !== false),
    Effect.orElseSucceed(() => false),
  );
  let current: DesktopSessionStateEntry["state"] | undefined;

  const recordUnsafe = (last: DesktopSessionStateEntry): void => {
    if (!policyAllows || current === "os_shutdown") return;
    // Read live: the login shell's environment can bring the opt-out after start.
    if (TELEMETRY_DISABLED.test(env.T3CODE_TELEMETRY_ENABLED?.trim() ?? "")) return;
    current = last.state;
    const text = encodeState({ sessionId, atMs: clock.currentTimeMillisUnsafe(), last });
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      try {
        NodeFS.writeFileSync(filePath, text);
        return;
      } catch {
        // Best effort: the next start then reports the reason as unknown.
      }
    }
  };

  const recoveredUnsafe = (state: DesktopSessionStateEntry["state"]): void => {
    if (current === state) recordUnsafe({ state: "running" });
  };

  return DesktopSessionState.of({ sessionId, recordUnsafe, recoveredUnsafe });
});

export const layer = Layer.effect(DesktopSessionState, make);

const disabled = {
  recordUnsafe: (_last: DesktopSessionStateEntry) => {},
  recoveredUnsafe: (_state: DesktopSessionStateEntry["state"]) => {},
};

/** Where the app provides the service; tests that build one service alone record nothing. */
export const optional = Effect.serviceOption(DesktopSessionState).pipe(
  Effect.map((service) => (service._tag === "Some" ? service.value : disabled)),
);

/** Suspend, resume and (macOS, Linux) shutdown; Windows reports a session end to each window. */
export const layerPowerEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const powerMonitor = yield* ElectronPowerMonitor.ElectronPowerMonitor;
    const { recordUnsafe } = yield* DesktopSessionState;
    yield* electronApp.whenReady.pipe(
      Effect.andThen(
        Effect.all([
          powerMonitor.onSimpleEvent("suspend", () => recordUnsafe({ state: "suspended" })),
          powerMonitor.onSimpleEvent("resume", () => recordUnsafe({ state: "running" })),
          powerMonitor.onSimpleEvent("shutdown", () => recordUnsafe({ state: "os_shutdown" })),
        ]),
      ),
      Effect.ignore,
      Effect.forkScoped,
    );
  }),
);
