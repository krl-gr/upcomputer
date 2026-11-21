import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";

function turnItems(
  threadId: OrchestrationV2ThreadProjection["thread"]["id"],
  turn: number,
  outputBytes: number,
): OrchestrationV2TurnItem[] {
  const base = {
    threadId,
    runId: `run-${turn}`,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: null,
  };
  return [
    {
      ...base,
      id: `user-${turn}`,
      type: "user_message",
      inputIntent: "turn_start",
      ordinal: turn * 1_000_000 + 1,
    },
    {
      ...base,
      id: `command-${turn}`,
      type: "command_execution",
      input: "ls",
      output: "x".repeat(outputBytes),
      exitCode: 0,
      ordinal: turn * 1_000_000 + 2,
    },
  ] as unknown as OrchestrationV2TurnItem[];
}

/** `turns` settled turns of a user message and a command, each with its run's records. */
export function settledTurnsProjection(
  base: OrchestrationV2ThreadProjection,
  turns: number,
  options: { readonly outputBytes?: number; readonly running?: number } = {},
): OrchestrationV2ThreadProjection {
  const items = Array.from({ length: turns }, (_, turn) =>
    turnItems(base.thread.id, turn + 1, options.outputBytes ?? 10),
  ).flat();
  const runIds = Array.from({ length: turns }, (_, turn) => `run-${turn + 1}`);
  const record = (kind: string) => (runId: string) => ({ id: `${kind}-${runId}`, runId });
  return {
    ...base,
    runs: runIds.map(
      (id, index) =>
        ({
          id,
          ordinal: index + 1,
          status: options.running === index + 1 ? "running" : "completed",
        }) as unknown as OrchestrationV2Run,
    ),
    attempts: runIds.map(record("attempt")) as never,
    nodes: runIds.map(record("node")) as never,
    messages: [
      ...runIds.map(record("message")),
      // Messages the server keeps outside any history window.
      { id: "delegated-completion", runId: "run-1", delegatedCompletion: {} },
      { id: "workflow-script", runId: "run-2", workflowScript: true },
    ] as never,
    checkpoints: runIds.map(record("checkpoint")) as never,
    providerTurns: runIds.map((runId) => ({
      id: `provider-turn-${runId}`,
      runAttemptId: `attempt-${runId}`,
    })) as never,
    turnItems: items,
    visibleTurnItems: items.map((item, position): OrchestrationV2ProjectedTurnItem => ({
      position,
      visibility: "local",
      sourceThreadId: base.thread.id,
      sourceItemId: item.id,
      item,
    })),
  };
}
