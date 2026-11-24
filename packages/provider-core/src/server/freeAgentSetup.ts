import { FREE_AGENT_SETUP_INSTRUCTIONS } from "@t3tools/contracts";

/** OpenCode's driver: a new user without an agent gets it on a free model. */
export const FREE_AGENT_DRIVER = "opencode";

/**
 * While the free agent is the only working agent, OpenCode gets `FREE_AGENT_SETUP_INSTRUCTIONS`
 * and the onboarding offer waits for a real agent. Kept in sync with the provider registry by
 * `apps/server/src/provider/FreeAgentSetup.ts`.
 */
interface FreeAgentSetupState {
  readonly active: boolean;
  readonly freeAgentInstanceIds: ReadonlySet<string>;
}

let state: FreeAgentSetupState = { active: false, freeAgentInstanceIds: new Set() };

/** Set by the server from its provider registry; tests set it directly. */
export function setFreeAgentSetup(next: {
  readonly active: boolean;
  readonly freeAgentInstanceIds: Iterable<string>;
}): void {
  state = { active: next.active, freeAgentInstanceIds: new Set(next.freeAgentInstanceIds) };
}

export function isFreeAgentSetupActive(): boolean {
  return state.active;
}

/** Whether a provider instance is OpenCode, the free agent. */
export function isFreeAgentInstance(instanceId: string): boolean {
  return state.freeAgentInstanceIds.has(instanceId);
}

/** The setup block for an OpenCode session, or `undefined` once another agent works. */
export function currentFreeAgentSetupBlock(): string | undefined {
  return state.active ? FREE_AGENT_SETUP_INSTRUCTIONS : undefined;
}
