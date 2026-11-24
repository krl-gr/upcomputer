import { FREE_AGENT_SETUP_INSTRUCTIONS } from "@t3tools/contracts";

/** OpenCode's driver: a new user without an agent gets it on a free model. */
export const FREE_AGENT_DRIVER = "opencode";
// Zen names its free models `-free`, and provider-opencode's automatic choice prefers them.
const FREE_MODEL_PREFIX = "opencode/";
const FREE_MODEL_SUFFIX = "-free";
/** SQL LIKE pattern for `isFreeAgentModel`. */
export const FREE_AGENT_MODEL_LIKE = `${FREE_MODEL_PREFIX}%${FREE_MODEL_SUFFIX}`;

/** A free Zen model. The user's own OpenCode on a paid model or their own keys is not the free agent. */
function isFreeAgentModel(model: string): boolean {
  return model.startsWith(FREE_MODEL_PREFIX) && model.endsWith(FREE_MODEL_SUFFIX);
}

/**
 * While the free agent is the only working agent, OpenCode on a free model gets
 * `FREE_AGENT_SETUP_INSTRUCTIONS` and the onboarding offer waits for a real agent. Kept in sync
 * with the provider registry by `apps/server/src/provider/FreeAgentSetup.ts`.
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

/** Whether a run went to the free agent: OpenCode on a free Zen model. */
export function isFreeAgentRun(run: {
  readonly providerInstanceId: string;
  readonly modelSelection: { readonly model: string };
}): boolean {
  return (
    state.freeAgentInstanceIds.has(run.providerInstanceId) &&
    isFreeAgentModel(run.modelSelection.model)
  );
}

/** The setup block for an OpenCode turn on `model`, or `undefined` once another agent works. */
export function currentFreeAgentSetupBlock(model: string): string | undefined {
  return state.active && isFreeAgentModel(model) ? FREE_AGENT_SETUP_INSTRUCTIONS : undefined;
}
