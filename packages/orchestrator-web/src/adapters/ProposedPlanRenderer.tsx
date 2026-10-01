import type { ProposedPlanRendererProps } from "./slotProps.ts";

import { OrchestrationProposalCard } from "../components/OrchestrationProposalCard.tsx";
import { resolvePrivateProposalTarget } from "./usePrivateProposal.ts";

export default function ProposedPlanRenderer(props: ProposedPlanRendererProps) {
  const target = resolvePrivateProposalTarget({
    environmentId: props.environmentId,
    threadId: props.threadId,
    planId: props.proposedPlan.id,
  });

  if (!target) {
    return <>{props.fallback}</>;
  }

  return <OrchestrationProposalCard target={target} fallback={props.fallback} />;
}
