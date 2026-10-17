import { parseTaskAgentRunEndInterruptReason } from "@t3tools/shared/taskAgentRunInterrupt";

export type RunInterruptResultKind = "interrupted" | "finished" | "stopped" | "failed";

export interface RunInterruptResultPresentation {
  readonly kind: RunInterruptResultKind;
  readonly label: string;
  readonly detail: string;
  readonly tone: "neutral" | "danger";
}

/**
 * The tasks server interrupts the turn of a task-agent run that ended, with the
 * run's status as the request's reason. That end is shown instead of an
 * interruption by the user.
 */
export function runInterruptResultPresentation(input: {
  readonly resultMessage: string;
  readonly requestMessage: string | null;
}): RunInterruptResultPresentation {
  const status = parseTaskAgentRunEndInterruptReason(input.requestMessage);
  switch (status) {
    case null:
      return {
        kind: "interrupted",
        label: "Run interrupted",
        detail: input.resultMessage,
        tone: "danger",
      };
    case "completed":
      return {
        kind: "finished",
        label: "Run finished",
        detail: "Task handed off",
        tone: "neutral",
      };
    case "blocked":
      return {
        kind: "finished",
        label: "Run finished",
        detail: "Blocker reported",
        tone: "neutral",
      };
    case "stopped":
      return {
        kind: "stopped",
        label: "Run stopped",
        detail: "Stopped by a person or agent",
        tone: "neutral",
      };
    case "failed":
      return {
        kind: "failed",
        label: "Run failed",
        detail: "Task agent run failed",
        tone: "danger",
      };
    case "interrupted":
      return {
        kind: "failed",
        label: "Run interrupted",
        detail: "Task agent run could not continue",
        tone: "danger",
      };
    default:
      return {
        kind: "stopped",
        label: "Run ended",
        detail: `Task agent run ${status}`,
        tone: "neutral",
      };
  }
}
