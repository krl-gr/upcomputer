import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import type { TaskAgent } from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../rpc/index.ts";
import { setAgentArchived } from "./agentUpsert.ts";

function fakeClient(stored: TaskAgent[]) {
  const upserts: unknown[] = [];
  const client = {
    agents: {
      search: async () => ({ agents: stored }),
      upsert: async (input: unknown) => {
        upserts.push(input);
        return stored[0]!;
      },
    },
  } as unknown as Pick<TasksWebRpcClient, "agents">;
  return { client, upserts };
}

test("archiving flips the flag on the stored definition, not on a stale copy", async () => {
  const stored = {
    id: "agent-1",
    projectId: "project-1",
    name: "Reviewer",
    enabled: false,
    startStatuses: ["To Do"],
    startTags: ["review"],
    startRunStatuses: [],
    config: {
      instructions: "Saved a moment ago",
      modelSelection: { instanceId: "codex", model: "new-model" },
    },
    archivedAt: null,
  } as unknown as TaskAgent;
  const { client, upserts } = fakeClient([stored]);

  await setAgentArchived(client, { id: stored.id, projectId: stored.projectId }, true);

  NodeAssert.deepEqual(upserts, [
    {
      id: "agent-1",
      projectId: "project-1",
      name: "Reviewer",
      enabled: false,
      startStatuses: ["To Do"],
      startTags: ["review"],
      startRunStatuses: [],
      config: stored.config,
      archived: true,
    },
  ]);
});

test("archiving a worker that was deleted meanwhile does not recreate it", async () => {
  const { client, upserts } = fakeClient([]);

  await NodeAssert.rejects(
    setAgentArchived(client, { id: "agent-1", projectId: "project-1" } as TaskAgent, true),
  );
  NodeAssert.deepEqual(upserts, []);
});
