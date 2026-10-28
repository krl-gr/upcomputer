import {
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";

const WORKSPACE_PREPARATION_INPUT = "Preparing workspace";

export function turnItemIsWorkspacePreparation(item: OrchestrationV2TurnItem): boolean {
  return (
    (item.type === "command_execution" && item.input === WORKSPACE_PREPARATION_INPUT) ||
    (item.type === "error" &&
      item.status === "cancelled" &&
      item.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE)
  );
}

export function workspacePreparationRetryRunIds(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status" | "workspacePreparation">>,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlySet<OrchestrationV2Run["id"]> {
  const failedRuns = new Set(
    runs.flatMap((run) =>
      run.status === "failed" && run.workspacePreparation !== undefined ? [run.id] : [],
    ),
  );
  const retryable = new Set<OrchestrationV2Run["id"]>();
  if (failedRuns.size === 0) return retryable;
  for (const item of items) {
    if (
      item.type === "error" &&
      item.status === "failed" &&
      item.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE &&
      item.runId !== null &&
      failedRuns.has(item.runId)
    )
      retryable.add(item.runId);
  }
  return retryable;
}

/** Codes that a person fixes in Settings rather than by sending again. */
const SETTINGS_FAILURE_CODES = new Set([
  "session_open_failed",
  "authentication_failed",
  "provider_instance_missing",
  "workspace_missing",
  "model_unavailable",
]);

export type ProviderFailureAction = "retry" | "switch_model" | "open_settings";

/**
 * The buttons under a failed turn, most useful first. Usage limits lead with
 * switching provider or model; retrying is second because it waits for the reset.
 */
export function providerFailureActions(
  failure: Extract<OrchestrationV2TurnItem, { readonly type: "error" }>["failure"],
): ReadonlyArray<ProviderFailureAction> {
  if (failure.class === "usage_limit") return ["switch_model", "retry"];
  if (
    failure.class === "permission_error" ||
    (failure.code !== null && SETTINGS_FAILURE_CODES.has(failure.code))
  ) {
    return failure.retryable === false ? ["open_settings"] : ["open_settings", "retry"];
  }
  return failure.retryable === false ? [] : ["retry"];
}
