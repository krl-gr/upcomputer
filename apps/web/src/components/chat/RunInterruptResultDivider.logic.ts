import { parseTaskAgentRunEndInterruptReason } from "@t3tools/shared/taskAgentRunInterrupt";
import type { useGT } from "gt-react";

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
export function runInterruptResultPresentation(
  input: {
    readonly resultMessage: string;
    readonly requestMessage: string | null;
  },
  gt: ReturnType<typeof useGT>,
): RunInterruptResultPresentation {
  const status = parseTaskAgentRunEndInterruptReason(input.requestMessage);
  switch (status) {
    case null:
      return {
        kind: "interrupted",
        label: gt("Run interrupted"),
        detail: input.resultMessage,
        tone: "danger",
      };
    case "completed":
      return {
        kind: "finished",
        label: gt("Run finished"),
        detail: gt("Task handed off"),
        tone: "neutral",
      };
    case "blocked":
      return {
        kind: "finished",
        label: gt("Run finished"),
        detail: gt("Blocker reported"),
        tone: "neutral",
      };
    case "stopped":
      return {
        kind: "stopped",
        label: gt("Run stopped"),
        detail: gt("Stopped by a person or agent"),
        tone: "neutral",
      };
    case "failed":
      return {
        kind: "failed",
        label: gt("Run failed"),
        detail: gt("Worker run failed"),
        tone: "danger",
      };
    case "interrupted":
      return {
        kind: "failed",
        label: gt("Run interrupted"),
        detail: gt("Worker run could not continue"),
        tone: "danger",
      };
    default:
      return {
        kind: "stopped",
        label: gt("Run ended"),
        detail: gt("Worker run {status}", { status }),
        tone: "neutral",
      };
  }
}
