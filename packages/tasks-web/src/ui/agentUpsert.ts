import type { TaskAgent } from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../rpc/index.ts";

/** The worker as it is saved now; an upsert takes the whole definition. */
export function agentUpsertInput(agent: TaskAgent) {
  return {
    id: agent.id,
    projectId: agent.projectId,
    name: agent.name,
    enabled: agent.enabled,
    startStatuses: [...agent.startStatuses],
    startTags: [...agent.startTags],
    startRunStatuses: [...agent.startRunStatuses],
    config: agent.config,
  };
}

/**
 * Archives or unarchives a worker without touching the rest of its definition.
 * The upsert replaces the whole definition and the caller's copy can predate an
 * edit saved moments ago, so the flag is flipped on the stored copy.
 */
export async function setAgentArchived(
  client: Pick<TasksWebRpcClient, "agents">,
  agent: Pick<TaskAgent, "id" | "projectId">,
  archived: boolean,
): Promise<TaskAgent> {
  const { agents } = await client.agents.search({
    projectId: agent.projectId,
    includeArchived: true,
    limit: 500,
  });
  const stored = agents.find((candidate) => candidate.id === agent.id);
  if (!stored) throw new Error("This worker no longer exists.");
  return client.agents.upsert({ ...agentUpsertInput(stored), archived });
}
