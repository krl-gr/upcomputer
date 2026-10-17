import { describe, expect, it } from "vite-plus/test";

import {
  parseTaskAgentRunEndInterruptReason,
  taskAgentRunEndInterruptReason,
} from "./taskAgentRunInterrupt.ts";

describe("task-agent run end interrupt reason", () => {
  it("round-trips the ended run's status", () => {
    for (const status of ["completed", "stopped", "blocked", "failed", "interrupted"]) {
      expect(parseTaskAgentRunEndInterruptReason(taskAgentRunEndInterruptReason(status))).toBe(
        status,
      );
    }
  });

  it("reads reasons stored by earlier builds", () => {
    expect(parseTaskAgentRunEndInterruptReason("Task-agent run completed.")).toBe("completed");
  });

  it("ignores other interrupt reasons", () => {
    expect(parseTaskAgentRunEndInterruptReason("Interrupt requested")).toBeNull();
    expect(parseTaskAgentRunEndInterruptReason("Stopping: Task-agent run completed.")).toBeNull();
    expect(parseTaskAgentRunEndInterruptReason(null)).toBeNull();
    expect(parseTaskAgentRunEndInterruptReason(undefined)).toBeNull();
  });
});
