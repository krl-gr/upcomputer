import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as ThreadViewers from "./ThreadViewers.ts";

it.effect("counts a thread as watched only while one of its subscriptions runs", () =>
  Effect.gen(function* () {
    const viewers = ThreadViewers.make();
    const seen: Array<boolean> = [];
    const probe = Stream.fromEffect(
      viewers.isWatched("a").pipe(Effect.tap((watched) => Effect.sync(() => seen.push(watched)))),
    );
    yield* Stream.runDrain(viewers.track("a", Stream.concat(viewers.track("a", probe), probe)));
    yield* Stream.runDrain(viewers.track("a", Stream.fail("closed"))).pipe(Effect.ignore);
    assert.deepStrictEqual(seen, [true, true]);
    assert.isFalse(yield* viewers.isWatched("a"));
    assert.isFalse(yield* viewers.isWatched("b"));
  }),
);
