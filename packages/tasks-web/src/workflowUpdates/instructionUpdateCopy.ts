import type { InstructionUpdateChange, InstructionUpdateEntry } from "@t3tools/tasks-contracts/v1";
import type { useGT } from "gt-react";

type GT = ReturnType<typeof useGT>;

/** What Settings and the bell say about an entry, translated. */
export interface InstructionUpdateCopy {
  readonly title: string;
  readonly summary: string;
  readonly why: string;
  /** A note after a status in the after list, such as what it replaced. */
  readonly statusNotes: Readonly<Record<string, string>>;
}

/**
 * The entries' copy, written out so it can be translated. An entry missing
 * here shows its English text (workflowUpdates.test.ts asks for it).
 */
export function instructionUpdateCopy(
  gt: GT,
  entry: InstructionUpdateEntry,
): InstructionUpdateCopy {
  switch (entry.id) {
    case "task-statuses-v2":
      return {
        title: gt("We updated how task statuses work"),
        summary: gt("New statuses, a new group order, and default instructions to match."),
        why: gt(
          "Some status names could be read two ways. Backlog meant an idea for one person and a queued task for another, and Needs Input and Needs Review did not say what was needed from you. The new names say who acts next. A task whose worker run crashes now moves to Failed instead of staying in progress.",
        ),
        statusNotes: {
          Queued: gt("approved, waiting in a worker's queue"),
          "Needs You": gt("was Needs Input"),
          Failed: gt("set automatically when a worker run crashes"),
          "To Verify": gt("was Needs Review"),
        },
      };
    default:
      return { title: entry.title, summary: entry.summary, why: entry.why, statusNotes: {} };
  }
}

/** The heading over one change's before and after. */
export function instructionUpdateChangeLabel(gt: GT, change: InstructionUpdateChange): string {
  switch (change.kind) {
    case "statuses":
      return gt("Task statuses");
    case "groupOrder":
      return gt("Status group order");
    case "failedOnCrash":
      return gt("Crashed worker runs");
    case "prompt":
      switch (change.field) {
        case "taskCreation":
          return gt("Task creation instructions");
        case "agentCreation":
          return gt("Worker creation instructions");
        case "automationCreation":
          return gt("Automation creation instructions");
        case "taskExecution":
          return gt("Task execution instructions");
      }
  }
}
