export interface TagSuggestion {
  readonly tag: string;
  /** The agents that start on this tag, by name; empty for a tag tasks already use. */
  readonly agents: readonly string[];
}

/**
 * Tags to offer while adding one to a task: the trigger tags of the enabled,
 * unarchived agents serving its project, labelled with those agents' names, then tags
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
    readonly archivedAt?: string | null;
    readonly projectId: string | null;
    readonly startTags: readonly string[];
  }>;
  readonly knownTags: readonly string[];
}): TagSuggestion[] {
  const has = new Set(input.taskTags);
  const agentsByTag = new Map<string, string[]>();
  for (const agent of input.agents) {
    if (
      !agent.enabled ||
      agent.archivedAt != null ||
      (agent.projectId !== null && agent.projectId !== input.projectId)
    )
      continue;
    for (const tag of agent.startTags)
      agentsByTag.set(tag, [...(agentsByTag.get(tag) ?? []), agent.name]);
  }
  const query = input.query.trim().toLocaleLowerCase();
  const matches = (suggestion: TagSuggestion) =>
    [suggestion.tag, ...suggestion.agents].some((text) => text.toLocaleLowerCase().includes(query));
  // Copies sorted in place: Hermes on the phone has no toSorted.
  const triggers = [...agentsByTag]
    .map(([tag, agents]) => ({ tag, agents: [...agents].sort((a, b) => a.localeCompare(b)) }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
  const known = [...new Set(input.knownTags)]
    .filter((tag) => !agentsByTag.has(tag))
    .sort((left, right) => left.localeCompare(right))
    .map((tag) => ({ tag, agents: [] }));
  return [...triggers, ...known].filter(
    (suggestion) => !has.has(suggestion.tag) && matches(suggestion),
  );
}

/** Splits typed list text on commas and new lines, trimmed, without blanks or repeats. */
export function splitListInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part, index, parts) => part.length > 0 && parts.indexOf(part) === index);
}

/** The tags after adding typed text to them; null when it adds none. */
export function tagsWithAdded(tags: readonly string[], text: string): string[] | null {
  const added = splitListInput(text).filter((tag) => !tags.includes(tag));
  return added.length > 0 ? [...tags, ...added] : null;
}
