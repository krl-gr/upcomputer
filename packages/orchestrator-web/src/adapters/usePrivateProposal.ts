import type { OrchestrationProposalSnapshot } from "@upcomputer/tasks-contracts/v1";
import {
  TASKS_WEB_ENVIRONMENT_API,
  applyProposalState,
  loadProposalState,
  resolveTasksWebAccess,
  type ProposalDataState,
  type ProposalStateTarget,
} from "@upcomputer/tasks-web";
import type { EnvironmentId, OrchestrationProposedPlanId, ThreadId } from "@upcomputer/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  readEnvironmentExtensionApi,
  readEnvironmentProductManifest,
} from "../../../../apps/web/src/extensionApi.ts";

export interface PrivateProposalTargetInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly planId: OrchestrationProposedPlanId;
}

export function resolvePrivateProposalTarget(
  input: PrivateProposalTargetInput,
): ProposalStateTarget | null {
  const client = readEnvironmentExtensionApi(input.environmentId, TASKS_WEB_ENVIRONMENT_API);
  if (!client) return null;
  const manifest = readEnvironmentProductManifest(input.environmentId);
  const access = resolveTasksWebAccess({
    manifest,
    metadataStatus: manifest === undefined ? "loading" : "ready",
  });
  return { ...input, client, access };
}

export function usePrivateProposal(input: PrivateProposalTargetInput) {
  const target = resolvePrivateProposalTarget(input);
  const [state, setState] = useState<ProposalDataState>({
    status: "loading",
    proposal: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!target) {
      setState({
        status: "unavailable",
        proposal: null,
        message: "The private proposal API is unavailable for this environment.",
      });
      return () => {
        cancelled = true;
      };
    }
    setState((current) => ({ status: "loading", proposal: current.proposal }));
    void loadProposalState(target).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [
    input.environmentId,
    input.threadId,
    input.planId,
    target?.client,
    target?.access.canReadProposals,
    target?.access.reason,
  ]);

  const apply = useCallback(async () => {
    if (!target || !state.proposal) {
      throw new Error("The private proposal is unavailable.");
    }
    const applying: ProposalDataState = {
      status: "applying",
      proposal: state.proposal,
    };
    setState(applying);
    try {
      const result = await applyProposalState(target, applying);
      setState(result.state);
      return result.result;
    } catch (error) {
      setState({
        status: "error",
        proposal: state.proposal,
        message: error instanceof Error ? error.message : "Could not apply proposal.",
      });
      throw error;
    }
  }, [
    input.environmentId,
    input.threadId,
    input.planId,
    state.proposal,
    target?.client,
    target?.access.canApplyProposals,
    target?.access.reason,
  ]);

  return {
    target,
    state,
    proposal: state.proposal as OrchestrationProposalSnapshot | null,
    canApply:
      target?.access.canApplyProposals === true && state.proposal?.applicationState === "pending",
    apply,
  };
}
