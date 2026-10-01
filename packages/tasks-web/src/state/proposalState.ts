import type {
  OrchestrationProposalApplyResult,
  OrchestrationProposalSnapshot,
  OrchestrationProposedPlanId,
} from "@upcomputer/tasks-contracts/v1";
import { IsoDateTime, type EnvironmentId, type ThreadId } from "@upcomputer/contracts";

import type { TasksWebAccess, TasksWebRpcClient } from "../rpc/index.ts";

export type ProposalDataState =
  | { readonly status: "loading"; readonly proposal: OrchestrationProposalSnapshot | null }
  | { readonly status: "ready"; readonly proposal: OrchestrationProposalSnapshot | null }
  | {
      readonly status: "unavailable";
      readonly proposal: OrchestrationProposalSnapshot | null;
      readonly message: string;
    }
  | {
      readonly status: "applying";
      readonly proposal: OrchestrationProposalSnapshot;
    }
  | {
      readonly status: "error";
      readonly proposal: OrchestrationProposalSnapshot | null;
      readonly message: string;
    };

export interface ProposalStateTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly planId: OrchestrationProposedPlanId;
  readonly client: TasksWebRpcClient;
  readonly access: TasksWebAccess;
}

export interface AppliedProposalState {
  readonly state: ProposalDataState;
  readonly result: OrchestrationProposalApplyResult;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Orchestrator proposal operation failed.";
}

export async function loadProposalState(
  target: ProposalStateTarget,
  previous?: ProposalDataState,
): Promise<ProposalDataState> {
  const priorProposal = previous?.proposal ?? null;
  if (!target.access.canReadProposals) {
    return { status: "unavailable", proposal: priorProposal, message: target.access.reason };
  }
  try {
    const result = await target.client.proposals.get({
      threadId: target.threadId,
      planId: target.planId,
    });
    return { status: "ready", proposal: result.proposal };
  } catch (error) {
    return { status: "error", proposal: priorProposal, message: errorMessage(error) };
  }
}

export async function applyProposalState(
  target: ProposalStateTarget,
  current: ProposalDataState,
): Promise<AppliedProposalState> {
  const proposal = current.proposal;
  if (!proposal || !target.access.canApplyProposals) {
    throw new Error(target.access.reason || "This proposal cannot be applied.");
  }
  const result = await target.client.proposals.apply({
    threadId: target.threadId,
    planId: target.planId,
  });
  const refreshed = await loadProposalState(target, {
    status: "applying",
    proposal,
  });
  if (refreshed.status === "ready" && refreshed.proposal?.applicationState === "applied") {
    return { state: refreshed, result };
  }

  // The successful Apply response confirms the committed server transaction.
  // Keep the UI fail-closed against a duplicate Apply even if the immediate
  // follow-up read was interrupted; a later reload replaces this projection
  // with the server's durable timestamps.
  const confirmedAt = IsoDateTime.make(new Date().toISOString());
  return {
    state: {
      status: "ready",
      proposal: {
        ...proposal,
        applicationState: "applied",
        agentIds: result.agents.map(({ id }) => id),
        taskIds: result.tasks.map(({ id }) => id),
        updatedAt: confirmedAt,
        appliedAt: confirmedAt,
      },
    },
    result,
  };
}
