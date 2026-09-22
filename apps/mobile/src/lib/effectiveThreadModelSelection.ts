import type { EnvironmentThreadShell } from "@upcomputer/client-runtime/state/shell";
import type { ModelSelection, ServerConfig } from "@upcomputer/contracts";

import { buildModelOptions } from "./modelOptions";

export type ExistingThreadModelSelectionState = Pick<
  EnvironmentThreadShell,
  "latestTurn" | "modelSelection" | "session"
> & {
  readonly messages?: ReadonlyArray<unknown>;
};

export function hasExistingThreadStarted(
  thread: Pick<ExistingThreadModelSelectionState, "latestTurn" | "messages" | "session">,
): boolean {
  return (
    thread.latestTurn !== null || thread.session !== null || (thread.messages?.length ?? 0) > 0
  );
}

/**
 * Resolve the model selection that an existing thread may safely use.
 *
 * Started threads are provider-instance bound. When an old persisted/draft
 * selection points at another instance, first normalize the same model and its
 * options against the bound instance's catalog capabilities. If that instance
 * does not expose the model, use its canonical default instead. A missing
 * catalog/default returns null so callers retain the draft/outbox item until
 * projection state is available.
 */
export function resolveExistingThreadModelSelection(input: {
  readonly thread: ExistingThreadModelSelectionState;
  readonly selectedModelSelection: ModelSelection;
  readonly serverConfig: ServerConfig | null | undefined;
}): ModelSelection | null {
  if (!hasExistingThreadStarted(input.thread)) {
    return input.selectedModelSelection;
  }

  const boundInstanceId =
    input.thread.session?.providerInstanceId ?? input.thread.modelSelection.instanceId;
  if (input.selectedModelSelection.instanceId === boundInstanceId) {
    return input.selectedModelSelection;
  }

  const boundOptions = buildModelOptions(input.serverConfig, null).filter(
    (option) => option.selection.instanceId === boundInstanceId,
  );
  const matchingModel = boundOptions.find(
    (option) => option.selection.model === input.selectedModelSelection.model,
  );
  if (matchingModel) {
    const reboundSelection = {
      ...input.selectedModelSelection,
      instanceId: boundInstanceId,
    };
    return (
      buildModelOptions(input.serverConfig, reboundSelection).find(
        (option) =>
          option.selection.instanceId === boundInstanceId &&
          option.selection.model === reboundSelection.model,
      )?.selection ?? matchingModel.selection
    );
  }
  return (
    boundOptions.find((option) => option.isDefault)?.selection ?? boundOptions[0]?.selection ?? null
  );
}
