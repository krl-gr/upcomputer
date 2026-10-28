import { assert } from "@effect/vitest";
import type { ProviderReplayTranscript } from "@t3tools/contracts";

import type { OrchestratorV2ScenarioResult } from "../../OrchestratorScenario.ts";
import {
  assertBaseProjection,
  assertSemanticProjectionIntegrity,
  assertUserMessagesInclude,
  CLAUDE_RESULT_IS_ERROR_FOLLOW_UP,
  CLAUDE_RESULT_IS_ERROR_PROMPT,
  projectionFor,
} from "../shared.ts";

const AUTH_ERROR_TEXT = "Failed to authenticate. API Error: 401 Invalid authentication credentials";
const AUTH_FAILURE_TEXT =
  "Claude Code is signed out. Sign in again in Settings, then send the message again.";

export function assertClaudeResultIsErrorOutput(
  result: OrchestratorV2ScenarioResult,
  transcript: ProviderReplayTranscript,
) {
  assertBaseProjection({
    result,
    transcript,
    runCount: 2,
    runStatuses: ["failed", "completed"],
  });

  const projection = projectionFor(result, transcript.scenario);
  assertSemanticProjectionIntegrity(projection);
  assertUserMessagesInclude(projection, [
    CLAUDE_RESULT_IS_ERROR_PROMPT,
    CLAUDE_RESULT_IS_ERROR_FOLLOW_UP,
  ]);

  const failedRun = projection.runs.find((run) => run.ordinal === 1);
  assert.isDefined(failedRun);
  assert.equal(failedRun?.status, "failed");
  const failedTurn = projection.providerTurns.find(
    (turn) => turn.status !== "completed" && turn.status !== "running",
  );
  assert.equal(failedTurn?.status, "failed");

  const errorItem = projection.turnItems.find(
    (item) => item.runId === failedRun?.id && item.type === "error",
  );
  assert.isDefined(errorItem);
  if (errorItem?.type !== "error") throw new Error("expected error item");
  assert.equal(errorItem.failure.message, AUTH_FAILURE_TEXT);
  // Details keep the command-line login steps; the CLI's own error stays in the reply.
  assert.include(errorItem.failure.detail ?? "", "claude auth login");
  assert.equal(errorItem.failure.code, "authentication_failed");
  assert.equal(errorItem.failure.class, "permission_error");

  const run1AssistantTexts = projection.turnItems.flatMap((item) =>
    item.runId === failedRun?.id && item.type === "assistant_message" ? [item.text] : [],
  );
  assert.deepEqual(run1AssistantTexts, [AUTH_ERROR_TEXT]);

  const recoveredRun = projection.runs.find((run) => run.ordinal === 2);
  assert.isDefined(recoveredRun);
  assert.equal(recoveredRun?.status, "completed");
  const recoveredTexts = projection.turnItems.flatMap((item) =>
    item.runId === recoveredRun?.id && item.type === "assistant_message" ? [item.text] : [],
  );
  assert.deepEqual(recoveredTexts, ["claude result is_error fixture recovered"]);
}
