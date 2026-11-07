import { assert, it, describe } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { VcsProcessSpawnError } from "@t3tools/contracts";

import * as VcsProcess from "./VcsProcess.ts";
import * as VcsProjectConfig from "./VcsProjectConfig.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

describe("VcsDriverRegistry without a runnable git", () => {
  it.effect("waits before trying a git that failed to start again", () =>
    Effect.gen(function* () {
      let spawns = 0;
      const layer = Layer.effect(VcsDriverRegistry.VcsDriverRegistry, VcsDriverRegistry.make).pipe(
        Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        Layer.provide(
          Layer.mock(VcsProjectConfig.VcsProjectConfig)({
            resolveKind: (input) => Effect.succeed(input.requestedKind ?? "auto"),
          }),
        ),
        Layer.provide(
          Layer.mock(VcsProcess.VcsProcess)({
            run: (input) =>
              Effect.suspend(() => {
                spawns += 1;
                return Effect.fail(
                  new VcsProcessSpawnError({
                    operation: input.operation,
                    command: input.command,
                    cwd: input.cwd,
                    cause: new Error("git needs the Xcode Command Line Tools"),
                  }),
                );
              }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
        const detect = registry.detect({ cwd: "/Users/new/.upcomputer" }).pipe(Effect.flip);

        assert.equal((yield* detect)._tag, "VcsProcessSpawnError");
        yield* detect;
        assert.equal(spawns, 1);

        yield* TestClock.adjust("31 seconds");
        yield* detect;
        assert.equal(spawns, 2);
      }).pipe(Effect.provide(layer));
    }),
  );
});
