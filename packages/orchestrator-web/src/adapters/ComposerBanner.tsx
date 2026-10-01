import type { ComposerBannerProps } from "./slotProps.ts";

import { ComposerOrchestrationProposalBanner } from "../components/ComposerOrchestrationProposalBanner.tsx";
import { useProposal } from "./useProposal.ts";

export default function ComposerBanner(props: ComposerBannerProps) {
  if (
    props.interactionMode !== "orchestrator" ||
    props.threadId === null ||
    props.proposedPlan === null
  ) {
    return null;
  }
  return (
    <LoadedComposerBanner {...props} threadId={props.threadId} proposedPlan={props.proposedPlan} />
  );
}

function LoadedComposerBanner(
  props: ComposerBannerProps & {
    readonly threadId: NonNullable<ComposerBannerProps["threadId"]>;
    readonly proposedPlan: NonNullable<ComposerBannerProps["proposedPlan"]>;
  },
) {
  const proposalState = useProposal({
    environmentId: props.environmentId,
    threadId: props.threadId,
    planId: props.proposedPlan.id,
  });
  if (!proposalState.proposal) return null;

  return (
    <ComposerOrchestrationProposalBanner
      proposal={proposalState.proposal}
      canApply={proposalState.canApply}
      isApplying={proposalState.state.status === "applying"}
      onApply={() => {
        void proposalState.apply().catch(() => undefined);
      }}
    />
  );
}
