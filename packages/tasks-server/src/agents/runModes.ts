import type { TaskAgent } from "@t3tools/tasks-contracts/v1";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";

const RUNTIME_MODE_RANK: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};
const INTERACTION_MODE_RANK: Record<ProviderInteractionMode, number> = { plan: 0, default: 1 };

/** The modes a run works in. */
export interface RunModes {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export function agentRunModes(config: TaskAgent["config"]): RunModes {
  return {
    runtimeMode: config.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode: config.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
  };
}

/** Which of the target's modes is broader than the ceiling's, or null when it fits. */
export function broaderRunMode(
  target: RunModes,
  ceiling: RunModes,
): "runtimeMode" | "interactionMode" | null {
  if (RUNTIME_MODE_RANK[target.runtimeMode] > RUNTIME_MODE_RANK[ceiling.runtimeMode]) {
    return "runtimeMode";
  }
  if (
    INTERACTION_MODE_RANK[target.interactionMode] > INTERACTION_MODE_RANK[ceiling.interactionMode]
  ) {
    return "interactionMode";
  }
  return null;
}
