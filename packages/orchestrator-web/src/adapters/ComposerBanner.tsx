import type { ComposerBannerProps } from "./slotProps.ts";

import { ComposerOrchestrationProposalBanner } from "../components/ComposerOrchestrationProposalBanner.tsx";
import { usePrivateProposal } from "./usePrivateProposal.ts";

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
  const privateProposal = usePrivateProposal({
    environmentId: props.environmentId,
    threadId: props.threadId,
    planId: props.proposedPlan.id,
  });
  if (!privateProposal.proposal) return null;

  return (
    <ComposerOrchestrationProposalBanner
      proposal={privateProposal.proposal}
      canApply={privateProposal.canApply}
      isApplying={privateProposal.state.status === "applying"}
      onApply={() => {
        void privateProposal.apply().catch(() => undefined);
      }}
    />
  );
}
