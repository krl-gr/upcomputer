import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 5_000;

/** Retry until success or scope interruption, with capped exponential delay. */
export function retryOperational<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  fields: Readonly<Record<string, unknown>>,
  attempt = 0,
): Effect.Effect<A, E, R> {
  return effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      const delayMs = Math.min(
        MAX_RETRY_DELAY_MS,
        INITIAL_RETRY_DELAY_MS * 2 ** Math.min(attempt, 6),
      );
      return Effect.logWarning("Retrying private task runtime operation", {
        ...fields,
        attempt: attempt + 1,
        delayMs,
        cause,
      }).pipe(
        Effect.andThen(Effect.sleep(Duration.millis(delayMs))),
        Effect.andThen(retryOperational(effect, fields, attempt + 1)),
      );
    }),
  );
}
