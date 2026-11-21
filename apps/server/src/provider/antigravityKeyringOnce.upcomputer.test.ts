import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient } from "effect/http";

import { rememberCliKeyringRead } from "./antigravityKeyringOnce.ts";
import { makeAntigravityUsageProbe } from "./antigravityUsageLimits.ts";

const MINUTE = 60_000;
const signIn = (expiresAt: number) =>
  JSON.stringify({
    token: {
      access_token: "access-token",
      expiry: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
    },
  });

describe("Antigravity keychain read", () => {
  it.effect("asks once after a refusal and again only after sign-in or sign-out", () =>
    Effect.gen(function* () {
      let reads = 0;
      const usage = yield* makeAntigravityUsageProbe({
        profileDirectory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
        authMethod: "oauth-personal",
        readKeyringSecret: Effect.suspend(() => {
          reads++;
          return Effect.die("User canceled the operation.");
        }),
      }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("no request without a sign-in")),
        ),
      );
      const first = yield* usage.probe;
      const second = yield* usage.probe;
      expect(reads).toBe(1);
      expect(second).toEqual(first);
      expect(first.unavailable).toEqual({
        reason: "unsupported",
        message: expect.stringContaining("Keychain access was not allowed"),
      });
      yield* usage.clear;
      yield* usage.probe;
      expect(reads).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("reuses a valid sign-in and reads an expired one at most once an hour", () =>
    Effect.gen(function* () {
      const reads: number[] = [];
      const keyring = rememberCliKeyringRead(
        Effect.sync(() => {
          const now = reads.length === 0 ? 0 : 61 * MINUTE;
          reads.push(now);
          return signIn(now + 30 * MINUTE);
        }),
      );
      yield* keyring.read;
      for (const minutes of [10, 40, 59]) {
        yield* TestClock.setTime(minutes * MINUTE);
        yield* keyring.read;
      }
      expect(reads).toHaveLength(1);
      yield* TestClock.setTime(61 * MINUTE);
      expect(yield* keyring.read).toBe(signIn(91 * MINUTE));
      yield* TestClock.setTime(80 * MINUTE);
      yield* keyring.read;
      expect(reads).toHaveLength(2);
    }),
  );

  it.effect("reads a missing sign-in again, since a missing item opens no prompt", () =>
    Effect.gen(function* () {
      let reads = 0;
      const keyring = rememberCliKeyringRead(Effect.sync(() => void reads++));
      yield* keyring.read;
      yield* keyring.read;
      expect(reads).toBe(2);
    }),
  );

  it.effect("shares a read still waiting on the prompt after its caller gave up", () =>
    Effect.gen(function* () {
      let reads = 0;
      const answered = yield* Deferred.make<string>();
      const keyring = rememberCliKeyringRead(
        Effect.suspend(() => {
          reads++;
          return Deferred.await(answered);
        }),
      );
      const timedOut = yield* Effect.forkChild(keyring.read, { startImmediately: true });
      yield* Fiber.interrupt(timedOut);
      const waiting = yield* Effect.forkChild(keyring.read, { startImmediately: true });
      yield* Deferred.succeed(answered, signIn(30 * MINUTE));
      expect(yield* Fiber.join(waiting)).toBe(signIn(30 * MINUTE));
      expect(reads).toBe(1);
    }),
  );
});
