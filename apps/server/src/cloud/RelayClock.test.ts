import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { HttpClientRequest, HttpClientResponse } from "effect/http";

import {
  makeRelayClock,
  observeRelayResponseDate,
  observeRelayTokenIssuedAt,
  RelayClock,
} from "./RelayClock.ts";

const RELAY_NOW = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const atLocalOffset = (millis: number) => TestClock.setTime(RELAY_NOW.epochMilliseconds + millis);

const offsetAfterObserving = (localOffsetMillis: number) =>
  Effect.gen(function* () {
    const clock = makeRelayClock();
    yield* atLocalOffset(localOffsetMillis);
    yield* clock.observe(RELAY_NOW);
    return yield* clock.offsetMillis;
  });

it.effect("corrects a clock that is minutes off in either direction", () =>
  Effect.gen(function* () {
    expect(yield* offsetAfterObserving(-10 * 60_000)).toBe(10 * 60_000);
    expect(yield* offsetAfterObserving(10 * 60_000)).toBe(-10 * 60_000);
  }),
);

it.effect("keeps local time for differences the relay already tolerates", () =>
  Effect.gen(function* () {
    expect(yield* offsetAfterObserving(-1_500)).toBe(0);
    expect(yield* offsetAfterObserving(29_000)).toBe(0);
  }),
);

it.effect("ignores an observation too far off to be a clock to correct", () =>
  Effect.gen(function* () {
    const clock = makeRelayClock();
    yield* atLocalOffset(-5 * 60_000);
    yield* clock.observe(RELAY_NOW);
    yield* atLocalOffset(13 * 60 * 60_000);
    yield* clock.observe(RELAY_NOW);
    expect(yield* clock.offsetMillis).toBe(5 * 60_000);
  }),
);

it.effect("drops the correction once the clock is fixed", () =>
  Effect.gen(function* () {
    const clock = makeRelayClock();
    yield* atLocalOffset(-10 * 60_000);
    yield* clock.observe(RELAY_NOW);
    yield* atLocalOffset(0);
    yield* clock.observe(RELAY_NOW);
    expect(yield* clock.offsetMillis).toBe(0);
    expect(DateTime.formatIso(yield* clock.now)).toBe(DateTime.formatIso(RELAY_NOW));
  }),
);

it.effect("reads relay time from a response Date header and a relay token's iat", () =>
  Effect.gen(function* () {
    yield* atLocalOffset(-10 * 60_000);
    const fromDate = makeRelayClock();
    yield* observeRelayResponseDate(
      HttpClientResponse.fromWeb(
        HttpClientRequest.get("https://relay.example.test"),
        new Response(null, { headers: { date: DateTime.toDate(RELAY_NOW).toUTCString() } }),
      ),
    ).pipe(Effect.provideService(RelayClock, fromDate));
    expect(DateTime.formatIso(yield* fromDate.now)).toBe(DateTime.formatIso(RELAY_NOW));

    const fromToken = makeRelayClock();
    const payload = Buffer.from(
      JSON.stringify({ iat: RELAY_NOW.epochMilliseconds / 1_000 }),
    ).toString("base64url");
    yield* observeRelayTokenIssuedAt(`e30.${payload}.signature`).pipe(
      Effect.provideService(RelayClock, fromToken),
    );
    expect(yield* fromToken.offsetMillis).toBe(10 * 60_000);

    yield* observeRelayTokenIssuedAt("not-a-jwt").pipe(
      Effect.provideService(RelayClock, fromToken),
    );
    expect(yield* fromToken.offsetMillis).toBe(10 * 60_000);
  }),
);
