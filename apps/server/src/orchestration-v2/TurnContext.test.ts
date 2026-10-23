import { assert, it } from "@effect/vitest";
import { ProviderThreadId, RunAttemptId, RunId } from "@t3tools/contracts";

import { deliveredTurnContextMarker } from "./TurnContext.ts";

const providerThreadId = ProviderThreadId.make("provider-thread:bot");
const runs = [1, 2, 3].map((ordinal) => ({
  id: RunId.make(`run:${ordinal}`),
  ordinal,
  status: "completed" as const,
}));
const attempt = (ordinal: number, marker: string, nativeThreadId = "native:a") => ({
  id: RunAttemptId.make(`attempt:${ordinal}`),
  runId: RunId.make(`run:${ordinal}`),
  attemptOrdinal: 1,
  providerThreadId,
  nativeThreadId,
  turnContextMarker: marker,
});
const accepted = [1, 2].map((ordinal) => ({
  runAttemptId: RunAttemptId.make(`attempt:${ordinal}`),
}));
const base = {
  providerThreadId,
  nativeThreadId: "native:a",
  runs,
  attempts: [attempt(1, "first"), attempt(2, "second"), attempt(3, "never-accepted")],
  providerTurns: accepted,
  turnItems: [],
};

it("offers the latest marker the same native conversation accepted", () => {
  assert.equal(deliveredTurnContextMarker(base), "second");
});

it("needs the full context in a new native conversation or provider thread", () => {
  assert.isUndefined(deliveredTurnContextMarker({ ...base, nativeThreadId: "native:fresh" }));
  assert.isUndefined(deliveredTurnContextMarker({ ...base, nativeThreadId: undefined }));
  assert.isUndefined(
    deliveredTurnContextMarker({
      ...base,
      providerThreadId: ProviderThreadId.make("provider-thread:other"),
    }),
  );
});

it("needs the full context after a compaction in or after the delivering run", () => {
  const compaction = (ordinal: number) => ({
    type: "compaction" as const,
    runId: RunId.make(`run:${ordinal}`),
    providerThreadId,
  });
  assert.equal(deliveredTurnContextMarker({ ...base, turnItems: [compaction(1)] }), "second");
  assert.isUndefined(deliveredTurnContextMarker({ ...base, turnItems: [compaction(2)] }));
  assert.isUndefined(deliveredTurnContextMarker({ ...base, turnItems: [compaction(3)] }));
});

it("skips a rolled-back run, whose prompt left native history", () => {
  assert.equal(
    deliveredTurnContextMarker({
      ...base,
      runs: runs.map((run) => (run.ordinal === 2 ? { ...run, status: "rolled_back" } : run)),
    }),
    "first",
  );
});
