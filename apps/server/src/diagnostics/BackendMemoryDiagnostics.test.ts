import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as TestClock from "effect/testing/TestClock";
import {
  isHeapPressure,
  readBackendMemorySample,
  startBackendMemoryDiagnostics,
} from "./BackendMemoryDiagnostics.ts";

it.effect("reports numeric counters and stops sampling when the server scope closes", () =>
  Effect.gen(function* () {
    const sample = readBackendMemorySample();
    assert.ok(Object.values(sample).every((value) => typeof value === "number" && value >= 0));
    assert.equal(isHeapPressure({ ...sample, heapUsedBytes: 79, heapLimitBytes: 100 }), false);
    assert.equal(isHeapPressure({ ...sample, heapUsedBytes: 80, heapLimitBytes: 100 }), true);
    const scope = yield* Scope.make();
    const firstSample = yield* Deferred.make<void>();
    let count = 0;
    yield* startBackendMemoryDiagnostics(() => {
      count += 1;
      Deferred.doneUnsafe(firstSample, Effect.void);
      return sample;
    }).pipe(Scope.provide(scope));
    yield* Deferred.await(firstSample);
    assert.equal(count, 1);
    yield* TestClock.adjust("60 seconds");
    assert.equal(count, 2);
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust("120 seconds");
    assert.equal(count, 2);
  }),
);
