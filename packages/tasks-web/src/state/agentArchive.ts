/**
 * Design stand-in for the worker archive: the server has no archived state for agents yet,
 * so it lives in this browser's storage. The backend phase replaces both functions with
 * the agent's own `archivedAt` and the archive and unarchive RPCs.
 */
const STORAGE_KEY = "upcomputer:design:archived-workers";

type ArchivedAgents = Readonly<Record<string, string>>;

function readArchived(): ArchivedAgents {
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}");
    return stored !== null && typeof stored === "object" ? (stored as ArchivedAgents) : {};
  } catch {
    return {};
  }
}

const archiveKey = (agent: { readonly environmentId: string; readonly id: string }) =>
  `${agent.environmentId}:${agent.id}`;

/** When the agent was archived, or null for an agent in the working set. */
export function agentArchivedAt(agent: {
  readonly environmentId: string;
  readonly id: string;
}): string | null {
  return readArchived()[archiveKey(agent)] ?? null;
}

export async function setAgentArchived(
  agent: { readonly environmentId: string; readonly id: string },
  archived: boolean,
): Promise<void> {
  const { [archiveKey(agent)]: _previous, ...rest } = readArchived();
  const next = archived ? { ...rest, [archiveKey(agent)]: new Date().toISOString() } : rest;
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Archived agents leave the working set: lists, pickers and tag suggestions skip them. */
export function isAgentArchived(agent: { readonly archivedAt?: string | null }): boolean {
  return agent.archivedAt != null;
}
