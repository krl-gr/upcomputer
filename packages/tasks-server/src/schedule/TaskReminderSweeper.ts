import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { forkParked } from "../../../../apps/server/src/extensionApi.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";

/**
 * Polled like automations: the host is a desktop machine that sleeps, and a
 * timer set for the next reminder would wake with a stale deadline.
 */
const REMINDER_SWEEP_INTERVAL = Duration.seconds(15);
const REMINDERS_PER_SWEEP = 50;

/**
 * After activation, recomputes pending reminders (the server's zone may have
 * changed since the last run), then claims due reminders every sweep. Claimed
 * reminders reach clients on the task change stream.
 */
export const TaskReminderSweeperLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const recompute = repository
      .recomputeReminders()
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to recompute task reminders", { cause }),
        ),
      );
    const sweep = repository
      .claimDueReminders({ limit: REMINDERS_PER_SWEEP })
      .pipe(
        Effect.catchCause((cause) => Effect.logWarning("Failed to send task reminders", { cause })),
      );
    yield* forkParked(
      recompute.pipe(
        Effect.andThen(sweep),
        Effect.andThen(
          Effect.forever(Effect.andThen(Effect.sleep(REMINDER_SWEEP_INTERVAL), sweep)),
        ),
      ),
    );
  }),
);
