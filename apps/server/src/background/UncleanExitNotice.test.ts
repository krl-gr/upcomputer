import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as ServerConfig from "../config.ts";
import * as BackgroundNotices from "./BackgroundNotices.ts";
import * as UncleanExitNotice from "./UncleanExitNotice.ts";

const startServer = Effect.gen(function* () {
  const notices = yield* BackgroundNotices.BackgroundNotices;
  return (yield* notices.list).map(({ id }) => id);
});

it.effect("says the last run closed unexpectedly only after a run that didn't stop", () =>
  Effect.gen(function* () {
    const config = ServerConfig.layerTest(process.cwd(), { prefix: "unclean-exit-" });
    const run = Effect.scoped(
      Layer.build(UncleanExitNotice.layer.pipe(Layer.provideMerge(BackgroundNotices.layer))).pipe(
        Effect.flatMap((context) => startServer.pipe(Effect.provide(context))),
      ),
    );
    const sharedConfig = yield* Layer.build(config);
    // A clean first start, then a clean stop.
    assert.deepStrictEqual(yield* run.pipe(Effect.provide(sharedConfig)), []);
    assert.deepStrictEqual(yield* run.pipe(Effect.provide(sharedConfig)), []);
    // A run whose scope never closes leaves its marker, like a crash.
    const neverClosed = yield* Scope.make();
    yield* Layer.buildWithScope(
      UncleanExitNotice.layer.pipe(Layer.provide(BackgroundNotices.layer)),
      neverClosed,
    ).pipe(Effect.provide(sharedConfig));
    assert.deepStrictEqual(yield* run.pipe(Effect.provide(sharedConfig)), ["app:unclean-exit"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
