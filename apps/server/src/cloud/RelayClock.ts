import { decodeRelayJwt } from "@t3tools/shared/relayJwt";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";

/**
 * The relay checks the `iat`/`exp` of this environment's proofs against its own
 * clock with at most a minute of tolerance, and this server checks the relay's
 * proofs against its clock the same way. On a computer whose clock is off by
 * minutes both fail, so every timestamp exchanged with the relay is kept in
 * relay time: local time plus the offset last observed in a relay timestamp.
 * Proof lifetimes stay the same; only their anchor moves.
 */

// Smaller differences are measurement noise (one-second Date resolution plus
// latency) and sit well inside the relay's tolerance, so local time is kept.
const MIN_CORRECTED_OFFSET_MILLIS = Duration.toMillis(Duration.seconds(30));
// Beyond this the observation is not trusted as a clock to correct. It also
// keeps any correction far inside the one-day replay marker retention.
const MAX_CORRECTED_OFFSET_MILLIS = Duration.toMillis(Duration.hours(12));

export interface RelayClockShape {
  /** Records a timestamp the relay produced just now. */
  readonly observe: (relayTime: DateTime.DateTime) => Effect.Effect<void>;
  readonly offsetMillis: Effect.Effect<number>;
  readonly toRelayTime: (local: DateTime.Utc) => Effect.Effect<DateTime.Utc>;
  readonly now: Effect.Effect<DateTime.Utc>;
}

export const makeRelayClock = (): RelayClockShape => {
  let offsetMillis = 0;
  const toRelayTime = (local: DateTime.Utc) =>
    Effect.sync(() =>
      offsetMillis === 0 ? local : DateTime.add(local, { milliseconds: offsetMillis }),
    );
  return {
    observe: (relayTime) =>
      Effect.flatMap(DateTime.now, (localNow) =>
        Effect.sync(() => {
          const observed = relayTime.epochMilliseconds - localNow.epochMilliseconds;
          const magnitude = Math.abs(observed);
          if (magnitude > MAX_CORRECTED_OFFSET_MILLIS) return;
          offsetMillis = magnitude < MIN_CORRECTED_OFFSET_MILLIS ? 0 : observed;
        }),
      ),
    offsetMillis: Effect.sync(() => offsetMillis),
    toRelayTime,
    now: Effect.flatMap(DateTime.now, toRelayTime),
  };
};

/** One clock per process: there is one local clock and one relay. */
export class RelayClock extends Context.Reference<RelayClockShape>("t3/cloud/RelayClock", {
  defaultValue: makeRelayClock,
}) {}

const observe = Effect.fn("RelayClock.observe")(function* (
  relayTime: Option.Option<DateTime.DateTime>,
) {
  if (Option.isNone(relayTime)) return;
  const clock = yield* RelayClock;
  yield* clock.observe(relayTime.value);
});

export const observeRelayResponseDate = (response: HttpClientResponse.HttpClientResponse) =>
  observe(Option.flatMap(Option.fromNullishOr(response.headers.date), DateTime.make));

/** For a relay-signed token received moments after the relay issued it. */
export const observeRelayTokenIssuedAt = (token: string) =>
  Effect.try(() => decodeRelayJwt(token).iat).pipe(
    Effect.option,
    Effect.flatMap((issuedAt) =>
      observe(
        Option.flatMap(
          Option.filter(
            issuedAt,
            (value): value is number => typeof value === "number" && Number.isFinite(value),
          ),
          (seconds) => DateTime.make(seconds * 1_000),
        ),
      ),
    ),
  );
