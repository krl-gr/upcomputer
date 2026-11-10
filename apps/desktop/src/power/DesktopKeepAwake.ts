import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

export interface PowerSaveBlocker {
  readonly start: () => number;
  readonly stop: (id: number) => void;
}

/**
 * Up.computer: holds one system sleep blocker while any backend reports working
 * agents. Each backend is a source, so overlapping backends share the blocker and
 * a backend that exits or restarts drops only its own claim.
 */
export class DesktopKeepAwake extends Context.Service<
  DesktopKeepAwake,
  {
    readonly setForSource: (sourceId: string, active: boolean) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/power/DesktopKeepAwake") {}

export const make = Effect.fn("DesktopKeepAwake.make")(function* (blocker: PowerSaveBlocker) {
  const sources = new Set<string>();
  let blockerId: number | undefined;

  const apply = Effect.sync(() => {
    if (sources.size > 0 && blockerId === undefined) {
      blockerId = blocker.start();
      return "started" as const;
    }
    if (sources.size === 0 && blockerId !== undefined) {
      blocker.stop(blockerId);
      blockerId = undefined;
      return "stopped" as const;
    }
    return null;
  }).pipe(
    Effect.flatMap((change) =>
      change === null ? Effect.void : Effect.logInfo(`System sleep blocker ${change}`),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not change the system sleep blocker", { cause: String(cause) }),
    ),
  );

  yield* Effect.addFinalizer(() => Effect.sync(() => sources.clear()).pipe(Effect.andThen(apply)));

  return DesktopKeepAwake.of({
    setForSource: Effect.fn("DesktopKeepAwake.setForSource")(function* (sourceId, active) {
      if (active) sources.add(sourceId);
      else sources.delete(sourceId);
      yield* apply;
    }),
  });
});

// prevent-app-suspension keeps the system awake but lets the display sleep.
export const layer = Layer.effect(
  DesktopKeepAwake,
  make({
    start: () => Electron.powerSaveBlocker.start("prevent-app-suspension"),
    stop: (id) => Electron.powerSaveBlocker.stop(id),
  }),
);
