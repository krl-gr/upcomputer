import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as CursorSdk from "./CursorSdk.ts";

vi.mock("./sdk.ts", () => ({ Agent: {}, createAgentPlatform: {}, SqliteLocalAgentStore: {} }));

// Calls the guard directly with crash observers attached, Vitest's own listener detached.
const rejectWithObservers = (
  reason: unknown,
  observers: ReadonlyArray<(error: Error, origin: string) => void>,
) =>
  Effect.gen(function* () {
    const others = process.listeners("unhandledRejection");
    yield* Layer.build(CursorSdk.layer);
    const guard = process.listeners("unhandledRejection").find((l) => !others.includes(l));
    assert.isDefined(guard);
    using exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    using _log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const listener of others) process.off("unhandledRejection", listener);
    for (const observer of observers) process.on("uncaughtExceptionMonitor", observer);
    try {
      guard(reason, Promise.resolve());
    } finally {
      for (const observer of observers) process.off("uncaughtExceptionMonitor", observer);
      for (const listener of others) process.on("unhandledRejection", listener);
    }
    return exit.mock.calls;
  }).pipe(Effect.scoped);

describe("CursorSdk unhandled rejection guard and crash observers", () => {
  it.effect("still exits on unrelated unhandled rejections, telling crash observers first", () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      const exits = yield* rejectWithObservers(new Error("boom"), [
        (error, origin) => seen.push(`${origin} ${error.message}`),
      ]);
      assert.deepStrictEqual(exits, [[1]]);
      assert.deepStrictEqual(seen, ["unhandledRejection boom"]);
    }),
  );

  it.effect("still exits when a crash observer throws", () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      const exits = yield* rejectWithObservers(new Error("boom"), [
        () => {
          throw new Error("monitor broke");
        },
        (error, origin) => seen.push(`${origin} ${error.message}`),
      ]);
      assert.deepStrictEqual(exits, [[1]]);
      assert.deepStrictEqual(seen, ["unhandledRejection boom"]);
    }),
  );
});
