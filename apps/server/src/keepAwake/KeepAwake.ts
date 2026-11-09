import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

/**
 * Up.computer: tells the desktop app to block system sleep while any run on this
 * server works. Run and runtime-request events only trigger a re-check; the
 * projection tables are the truth, so a missed or reordered event cannot leave the
 * blocker on.
 */
export const make = Effect.fn("KeepAwake.make")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventSink = yield* EventSink.EventSinkV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const desktop = yield* DesktopTelemetryReceiver.DesktopTelemetryReceiver;

  // A new backend starts released on the desktop side.
  const reported = yield* Ref.make(false);
  const lock = yield* Semaphore.make(1);

  const report = (active: boolean) =>
    Ref.get(reported).pipe(
      Effect.flatMap((current) =>
        current === active
          ? Effect.void
          : desktop
              .setKeepAwake(active)
              .pipe(Effect.andThen(Ref.set(reported, active)), Effect.withSpan("KeepAwake.report")),
      ),
    );

  // A run that waits on an approval or a question stays `running`, but nothing works
  // until someone answers, so its pending request lets the computer sleep. Requests
  // the server answers itself are not a wait. The IN list repeats the predicate of
  // orchestration_v2_projection_runs_recovery_idx so SQLite searches that partial index.
  const hasWorkingRun = sql<{ readonly working: number }>`
    SELECT EXISTS (
      SELECT 1 FROM orchestration_v2_projection_runs run
      WHERE run.status IN ('queued', 'preparing', 'starting', 'running', 'waiting')
        AND run.status <> 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runtime_requests request
          WHERE request.thread_id = run.thread_id
            AND request.status = 'pending'
            AND request.kind NOT IN ('dynamic_tool_call', 'auth_refresh')
        )
    ) AS working
  `.pipe(Effect.map((rows) => rows[0]?.working === 1));

  const sync = lock.withPermits(1)(
    Effect.gen(function* () {
      const { keepAwakeWhileAgentsWork } = yield* settings.getSettings;
      yield* report(keepAwakeWhileAgentsWork && (yield* hasWorkingRun));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not update the desktop sleep blocker", { cause: String(cause) }),
      ),
    ),
  );

  // Snapshot the sequence before the first check so no run change slips between them.
  const afterSequence = yield* eventSink.latestSequence();
  const settingChanges = (yield* settings.subscribeChanges).pipe(
    Stream.map((current) => current.keepAwakeWhileAgentsWork),
    Stream.changes,
  );
  const runChanges = eventSink
    .stream({ afterSequence })
    .pipe(
      Stream.filter(
        (stored) =>
          stored.event.type === "run.created" ||
          stored.event.type === "run.updated" ||
          stored.event.type === "runtime-request.updated",
      ),
    );

  yield* sync;
  yield* Effect.addFinalizer(() => lock.withPermits(1)(report(false)).pipe(Effect.ignore));
  yield* forkParked(
    Stream.merge(runChanges, settingChanges).pipe(
      Stream.runForEach(() => sync),
      Effect.catchCause((cause) =>
        Effect.logWarning("Desktop sleep blocker stopped following runs", {
          cause: String(cause),
        }),
      ),
      Effect.ensuring(lock.withPermits(1)(report(false)).pipe(Effect.ignore)),
    ),
  );
});

/** Headless servers have no desktop app to hold the blocker, so they do nothing. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (config.desktopTelemetryControlFd === undefined) return;
    yield* make();
  }),
);
