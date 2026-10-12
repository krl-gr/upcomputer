/** An agent a person can hand a task to. */
export interface HandOffAgent {
  readonly id: string;
  readonly name: string;
  /** Null for an agent that serves every project. */
  readonly projectId: string | null;
  readonly enabled: boolean;
  /** Statuses the agent starts on; empty means any. */
  readonly startStatuses: readonly string[];
  readonly startTags: readonly string[];
  /** Set for an agent that starts only on another agent's run outcome. */
  readonly startRunStatuses: readonly string[];
}

/**
 * The agents a task in `projectId` can go to: the enabled agents serving that
 * project that start on a task's own state, by name. An agent that starts
 * only on another agent's run would never start on a handed-off task.
 */
export function handOffAgents<Agent extends HandOffAgent>(
  agents: readonly Agent[],
  projectId: string,
): readonly Agent[] {
  return agents
    .filter(
      (agent) =>
        agent.enabled &&
        agent.startRunStatuses.length === 0 &&
        (agent.projectId === null || agent.projectId === projectId),
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * What handing a person task to agents changes: it becomes an agent task, and
 * with a chosen agent it meets that agent's start conditions, so the agent
 * starts on it: it carries the agent's start tags, moves to the agent's first
 * start status unless it is already in one, and names the agent as
 * `metadata.targetAgentId`.
 */
export function handOffPatch(
  task: { readonly status: string; readonly tags: readonly string[]; readonly metadata: unknown },
  agent: HandOffAgent | null,
) {
  if (!agent) return { audience: "agent" as const };
  const startStatus =
    agent.startStatuses.length === 0 || agent.startStatuses.includes(task.status)
      ? null
      : agent.startStatuses[0];
  const metadata =
    typeof task.metadata === "object" && task.metadata !== null && !Array.isArray(task.metadata)
      ? task.metadata
      : {};
  return {
    audience: "agent" as const,
    ...(startStatus ? { status: startStatus } : {}),
    tags: [...new Set([...task.tags, ...agent.startTags])],
    metadata: { ...metadata, targetAgentId: agent.id },
  };
}
