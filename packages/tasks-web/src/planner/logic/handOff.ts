/** An agent a person can hand a task to. */
export interface HandOffAgent {
  readonly id: string;
  readonly name: string;
  /** Null for an agent that serves every project. */
  readonly projectId: string | null;
  readonly enabled: boolean;
  readonly startTags: readonly string[];
}

/** The agents a task in `projectId` can go to: the enabled agents serving that project, by name. */
export function handOffAgents(
  agents: readonly HandOffAgent[],
  projectId: string,
): readonly HandOffAgent[] {
  return agents
    .filter((agent) => agent.enabled && (agent.projectId === null || agent.projectId === projectId))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * What handing a person task to agents changes: it becomes an agent task, and
 * with a chosen agent it carries that agent's start tags (so the agent starts
 * on it) and names it as `metadata.targetAgentId`.
 */
export function handOffPatch(
  task: { readonly tags: readonly string[]; readonly metadata: unknown },
  agent: HandOffAgent | null,
) {
  if (!agent) return { audience: "agent" as const };
  const metadata =
    typeof task.metadata === "object" && task.metadata !== null && !Array.isArray(task.metadata)
      ? task.metadata
      : {};
  return {
    audience: "agent" as const,
    tags: [...new Set([...task.tags, ...agent.startTags])],
    metadata: { ...metadata, targetAgentId: agent.id },
  };
}
