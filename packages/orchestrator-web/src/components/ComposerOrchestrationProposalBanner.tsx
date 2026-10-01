import type {
  OrchestrationProposalSpec,
  OrchestrationProposalSnapshot,
} from "@upcomputer/tasks-contracts/v1";
import { CheckIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";

const LABEL_TEXT_CLASS = "text-sm font-normal leading-relaxed tracking-normal";
const LABEL_COLOR_CLASS = "text-foreground dark:text-white/82";

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export interface ComposerOrchestrationProposalBannerProps {
  readonly proposal: OrchestrationProposalSnapshot | null;
  readonly fallbackProposal?: OrchestrationProposalSpec | null;
  readonly canApply: boolean;
  readonly isApplying: boolean;
  readonly onApply: () => void;
}

/** Compact composer banner driven by durable private proposal state. */
export const ComposerOrchestrationProposalBanner = memo(
  function ComposerOrchestrationProposalBanner({
    proposal,
    fallbackProposal = null,
    canApply,
    isApplying,
    onApply,
  }: ComposerOrchestrationProposalBannerProps) {
    const spec = proposal?.proposal ?? fallbackProposal;
    const agentCount = spec?.agents?.length ?? 0;
    const taskCount = spec?.tasks?.length ?? 0;
    const applied = proposal?.applicationState === "applied";
    const hasItems = agentCount > 0 || taskCount > 0;
    const applyEnabled = canApply && hasItems && !applied && !isApplying;

    return (
      <div className="px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("uppercase", LABEL_COLOR_CLASS, LABEL_TEXT_CLASS)}>
            {applied ? "Orchestration started" : "Orchestration ready"}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", LABEL_COLOR_CLASS, LABEL_TEXT_CLASS)}>
            {hasItems
              ? `${countLabel(agentCount, "agent")} · ${countLabel(taskCount, "task")}`
              : "Structured proposal unavailable"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={!applyEnabled}
            onClick={onApply}
            className="h-8 shrink-0 gap-1.5 px-3 text-xs"
          >
            <CheckIcon className="size-3.5" />
            {applied ? "Started" : isApplying ? "Applying" : "Apply"}
          </Button>
        </div>
      </div>
    );
  },
);
