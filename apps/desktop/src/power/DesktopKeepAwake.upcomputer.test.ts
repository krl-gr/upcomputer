import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import * as DesktopKeepAwake from "./DesktopKeepAwake.ts";

vi.mock("electron", () => ({}));

const makeBlocker = () => {
  const calls: Array<string> = [];
  let nextId = 0;
  return {
    calls,
    blocker: {
      start: () => {
        nextId += 1;
        calls.push(`start:${nextId}`);
        return nextId;
      },
      stop: (id: number) => {
        calls.push(`stop:${id}`);
      },
    } satisfies DesktopKeepAwake.PowerSaveBlocker,
  };
};

describe("DesktopKeepAwake", () => {
  it.effect("holds one blocker while any backend works and releases it when none does", () =>
    Effect.gen(function* () {
      const { calls, blocker } = makeBlocker();
      const scope = yield* Scope.make();
      const keepAwake = yield* DesktopKeepAwake.make(blocker).pipe(Scope.provide(scope));

      yield* keepAwake.setForSource("primary", true);
      yield* keepAwake.setForSource("primary", true);
      yield* keepAwake.setForSource("wsl", true);
      yield* keepAwake.setForSource("primary", false);
      assert.deepStrictEqual(calls, ["start:1"]);

      yield* keepAwake.setForSource("wsl", false);
      yield* keepAwake.setForSource("wsl", false);
      assert.deepStrictEqual(calls, ["start:1", "stop:1"]);

      yield* keepAwake.setForSource("primary", true);
      yield* Scope.close(scope, Exit.void);
      assert.deepStrictEqual(calls, ["start:1", "stop:1", "start:2", "stop:2"]);
    }),
  );
});
