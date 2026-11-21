import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The agy CLI owns its keychain item, so macOS asks the user on every read by another app
// unless they chose Always Allow. An expired sign-in is read again at most once an hour.
const EXPIRED_REREAD_MS = 60 * 60_000;

const decodeExpiry = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ token: Schema.Struct({ expiry: Schema.optional(Schema.String) }) }),
  ),
);

export class AntigravityKeyringRefusedError extends Schema.TaggedError<AntigravityKeyringRefusedError>()(
  "AntigravityKeyringRefusedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Up.computer could not read the Antigravity sign-in from the keychain.";
  }
}

/**
 * Remembers the keychain read so the user is asked once: a refusal sticks until `reset` (sign-in,
 * sign-out) or a restart, a valid sign-in is reused, and a read waiting on the macOS prompt is
 * shared instead of opening another prompt after the probe times out.
 */
export function rememberCliKeyringRead<E>(read: Effect.Effect<string | undefined, E>) {
  let last:
    | { readonly fiber: Fiber.Fiber<string | undefined, E>; readonly readAt: number }
    | undefined;
  const reusable = (now: number) => {
    const exit = last?.fiber.pollUnsafe();
    if (!last || (exit && Exit.isSuccess(exit) && exit.value === undefined)) return false;
    if (!exit || Exit.isFailure(exit)) return true;
    const expiry = Option.getOrUndefined(decodeExpiry(exit.value))?.token.expiry;
    return Date.parse(expiry ?? "") > now + 60_000 || now - last.readAt < EXPIRED_REREAD_MS;
  };
  return {
    read: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const current =
        last && reusable(now)
          ? last
          : (last = { fiber: yield* Effect.forkDetach(read), readAt: now });
      return yield* Fiber.join(current.fiber).pipe(
        Effect.catchCause((cause) => Effect.fail(new AntigravityKeyringRefusedError({ cause }))),
      );
    }),
    reset: () => {
      last = undefined;
    },
  };
}

/** A refusal is quiet: limits stay hidden with a reason instead of a failed-probe notice. */
export const keyringRefusedLimits = Effect.fn("AntigravityUsageProbe.keyringRefused")(function* (
  _error: AntigravityKeyringRefusedError,
) {
  return makeUnavailableUsageLimits({
    checkedAt: DateTime.formatIso(yield* DateTime.now),
    reason: "unsupported",
    message:
      "Keychain access was not allowed, so Antigravity limits are hidden. Sign in to Antigravity again or restart Up.computer to retry.",
  });
});
