import { assert, it } from "@effect/vitest";
import { TaskAgentRunId, TaskTag } from "@t3tools/tasks-contracts/v1";

import { agentRunTrigger } from "./agentRuns.ts";

const run = { triggerRunId: null, continuesRunId: null };
const statusAgent = { startTags: [] };
const taggedAgent = { startTags: [TaskTag.make("dev-2")] };
const automationTask = { metadata: { source: "automation", automationName: "Nightly" } };

it("names what started a run, the most specific start first", () => {
  assert.strictEqual(agentRunTrigger({ run, task: null, agent: statusAgent }), "status");
  assert.strictEqual(agentRunTrigger({ run, task: { metadata: null }, agent: taggedAgent }), "tag");
  assert.strictEqual(
    agentRunTrigger({ run, task: automationTask, agent: taggedAgent }),
    "schedule",
  );
  assert.strictEqual(
    agentRunTrigger({
      run: { ...run, continuesRunId: TaskAgentRunId.make("run:earlier") },
      task: automationTask,
      agent: taggedAgent,
    }),
    "message",
  );
  assert.strictEqual(
    agentRunTrigger({
      run: { ...run, triggerRunId: TaskAgentRunId.make("run:failed") },
      task: null,
      agent: null,
    }),
    "failure_handler",
  );
});
