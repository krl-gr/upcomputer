import type {
  OrchestrationProposalApplyResult,
  OrchestrationProposalSpec,
} from "@upcomputer/tasks-contracts/v1";
import {
  applyProposalState,
  loadProposalState,
  type ProposalDataState,
  type ProposalStateTarget,
} from "@upcomputer/tasks-web/state";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { ProposalDetails } from "./ProposalDetails.tsx";

export interface OrchestrationProposalCardProps {
  readonly target: ProposalStateTarget;
  readonly fallbackProposal?: OrchestrationProposalSpec | null;
  readonly fallback?: ReactNode;
  readonly onApplied?: (result: OrchestrationProposalApplyResult) => void;
  readonly onError?: (error: unknown) => void;
  readonly className?: string;
}

function initialState(): ProposalDataState {
  return { status: "loading", proposal: null };
}

function statusLabel(state: ProposalDataState): string {
  if (state.proposal?.applicationState === "applied") return "Started";
  if (state.proposal?.applicationState === "applying" || state.status === "applying") {
    return "Applying";
  }
  if (state.status === "loading") return "Loading";
  if (state.status === "error") return "Unavailable";
  return state.proposal ? "Ready" : "Draft";
}

/**
 * Private structured proposal renderer. Apply is permitted only after the
 * durable proposal was read from the server and the capability gate allows it.
 */
export function OrchestrationProposalCard({
  target,
  fallbackProposal = null,
  fallback = null,
  onApplied,
  onError,
  className,
}: OrchestrationProposalCardProps) {
  const [state, setState] = useState<ProposalDataState>(initialState);
  const durableProposal = state.proposal;
  const spec = durableProposal?.proposal ?? fallbackProposal;
  const applied = durableProposal?.applicationState === "applied";
  const applying = state.status === "applying" || durableProposal?.applicationState === "applying";
  const itemCount = (spec?.agents?.length ?? 0) + (spec?.tasks?.length ?? 0);
  const canApply =
    Boolean(durableProposal) &&
    durableProposal?.applicationState === "pending" &&
    target.access.canApplyProposals &&
    itemCount > 0;

  const reload = useCallback(() => {
    setState((current) => ({ status: "loading", proposal: current.proposal }));
    void loadProposalState(target, state).then(setState);
  }, [state, target]);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ status: "loading", proposal: current.proposal }));
    void loadProposalState(target)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            proposal: null,
            message: error instanceof Error ? error.message : "Could not load proposal.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    target.environmentId,
    target.threadId,
    target.planId,
    target.client,
    target.access.canReadProposals,
  ]);

  const apply = useCallback(() => {
    if (!durableProposal || !canApply || applying) return;
    const current: ProposalDataState = { status: "applying", proposal: durableProposal };
    setState(current);
    void applyProposalState(target, current)
      .then(({ state: next, result }) => {
        setState(next);
        onApplied?.(result);
      })
      .catch((error) => {
        setState({
          status: "error",
          proposal: durableProposal,
          message: error instanceof Error ? error.message : "Could not apply proposal.",
        });
        onError?.(error);
      });
  }, [applying, canApply, durableProposal, onApplied, onError, target]);

  if (state.status === "ready" && durableProposal === null && fallbackProposal === null) {
    return <>{fallback}</>;
  }

  return (
    <div
      className={cn(
        "rounded-[24px] border border-border/80 bg-card p-4 dark:bg-card/70 sm:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">Orchestration</p>
          <span
            className={cn(
              "shrink-0 text-sm font-medium",
              applied
                ? "text-success-foreground"
                : canApply
                  ? "text-info-foreground"
                  : "text-warning-foreground",
            )}
          >
            {statusLabel(state)}
          </span>
        </div>
        {durableProposal ? (
          <span className="text-xs text-muted-foreground">
            {durableProposal.agentIds.length} agents · {durableProposal.taskIds.length} tasks
            created
          </span>
        ) : null}
      </div>

      {spec ? (
        <div className="mt-4">
          <ProposalDetails proposal={spec} applied={applied} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {state.status === "loading"
            ? "Loading structured proposal..."
            : "Structured proposal unavailable."}
        </p>
      )}

      {state.status === "error" || state.status === "unavailable" ? (
        <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
          {state.message}
          {target.access.canReadProposals ? (
            <Button className="ml-2" size="xs" variant="outline" onClick={reload}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button size="sm" variant="default" disabled={!canApply || applying} onClick={apply}>
          {applied ? "Started" : applying ? "Starting" : "Start"}
        </Button>
      </div>
    </div>
  );
}
