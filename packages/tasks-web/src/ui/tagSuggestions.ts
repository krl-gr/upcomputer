export interface TagSuggestion {
  readonly tag: string;
  /** The agents that start on this tag, by name; empty for a tag tasks already use. */
  readonly agents: readonly string[];
}

/**
 * Tags to offer while adding one to a task: the trigger tags of the enabled
 * agents serving its project, labelled with those agents' names, then tags
 * other tasks use. Tags the task has are left out; `query` matches a tag or
 * an agent's name.
 */
export function tagSuggestions(input: {
  readonly query: string;
  readonly taskTags: readonly string[];
  readonly projectId: string | null;
  readonly agents: ReadonlyArray<{
    readonly name: string;
    readonly enabled: boolean;
    readonly projectId: string | null;
    readonly startTags: readonly string[];
  }>;
  readonly knownTags: readonly string[];
}): TagSuggestion[] {
  const has = new Set(input.taskTags);
  const agentsByTag = new Map<string, string[]>();
  for (const agent of input.agents) {
    if (!agent.enabled || (agent.projectId !== null && agent.projectId !== input.projectId))
      continue;
    for (const tag of agent.startTags)
      agentsByTag.set(tag, [...(agentsByTag.get(tag) ?? []), agent.name]);
  }
  const query = input.query.trim().toLocaleLowerCase();
  const matches = (suggestion: TagSuggestion) =>
    [suggestion.tag, ...suggestion.agents].some((text) => text.toLocaleLowerCase().includes(query));
  const triggers = [...agentsByTag]
    .map(([tag, agents]) => ({ tag, agents: agents.toSorted((a, b) => a.localeCompare(b)) }))
    .toSorted((left, right) => left.tag.localeCompare(right.tag));
  const known = [...new Set(input.knownTags)]
    .filter((tag) => !agentsByTag.has(tag))
    .toSorted((left, right) => left.localeCompare(right))
    .map((tag) => ({ tag, agents: [] }));
  return [...triggers, ...known].filter(
    (suggestion) => !has.has(suggestion.tag) && matches(suggestion),
  );
}
