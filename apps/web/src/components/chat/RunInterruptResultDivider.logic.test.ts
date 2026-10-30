import { describe, expect, it } from "vite-plus/test";

import { runInterruptResultPresentation } from "./RunInterruptResultDivider.logic";

const byUser = "Run interrupted by user";

describe("runInterruptResultPresentation", () => {
  it("keeps a person's Stop an interruption", () => {
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Interrupt requested",
      }),
    ).toEqual({ kind: "interrupted", label: "Run interrupted", detail: byUser, tone: "danger" });
    expect(runInterruptResultPresentation({ resultMessage: byUser, requestMessage: null })).toEqual(
      { kind: "interrupted", label: "Run interrupted", detail: byUser, tone: "danger" },
    );
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Stopping to change direction",
      }).label,
    ).toBe("Run interrupted");
  });

  it("shows a completed task-agent run as finished", () => {
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Task-agent run completed.",
      }),
    ).toEqual({
      kind: "finished",
      label: "Run finished",
      detail: "Task handed off",
      tone: "neutral",
    });
  });

  it("shows a blocked task-agent run as finished with a blocker", () => {
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Task-agent run blocked.",
      }),
    ).toEqual({
      kind: "finished",
      label: "Run finished",
      detail: "Blocker reported",
      tone: "neutral",
    });
  });

  it("shows a stopped task-agent run as stopped, not interrupted by the user", () => {
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Task-agent run stopped.",
      }),
    ).toEqual({
      kind: "stopped",
      label: "Run stopped",
      detail: "Stopped by a person or agent",
      tone: "neutral",
    });
  });

  it("shows a failed task-agent run as failed", () => {
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Task-agent run failed.",
      }),
    ).toEqual({
      kind: "failed",
      label: "Run failed",
      detail: "Worker run failed",
      tone: "danger",
    });
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Task-agent run interrupted.",
      }),
    ).toEqual({
      kind: "failed",
      label: "Run interrupted",
      detail: "Worker run could not continue",
      tone: "danger",
    });
  });

  it("names an unknown task-agent run end without blaming the user", () => {
    expect(
      runInterruptResultPresentation({
        resultMessage: byUser,
        requestMessage: "Task-agent run cancelled.",
      }),
    ).toEqual({
      kind: "stopped",
      label: "Run ended",
      detail: "Worker run cancelled",
      tone: "neutral",
    });
  });
});
