import type {
  EnvironmentId,
  OrchestrationProposedPlan,
  ProviderInteractionMode,
  ThreadId,
} from "@upcomputer/contracts";
import type { ReactNode } from "react";

// Props for the proposed-plan renderer and composer banner slots. The current
// web extension API no longer exposes these slots, so the adapters keep their
// own prop types until a host renders them again.

export interface ProposedPlanRendererProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly proposedPlan: OrchestrationProposedPlan;
  readonly cwd: string | undefined;
  readonly workspaceRoot: string | undefined;
  readonly fallback: ReactNode;
}

export interface ComposerBannerProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly interactionMode: ProviderInteractionMode;
  readonly proposedPlan: OrchestrationProposedPlan | null;
}
