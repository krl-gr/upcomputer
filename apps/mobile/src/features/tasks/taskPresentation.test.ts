import { describe, expect, it } from "vite-plus/test";

import { m } from "../../i18n/messages";
import { taskRunCounts } from "./taskPresentation";

describe("task run counts", () => {
  it("merges runs by state in the desktop's badge order and drops empty ones", () => {
    expect(
      taskRunCounts(
        [
          { status: "completed", count: 3 },
          { status: "finalizing:result", count: 1 },
          { status: "running", count: 1 },
          { status: "finalizing:stopped", count: 2 },
          { status: "failed", count: 0 },
        ],
        m,
      ).map((count) => [count.label, count.count, count.status]),
    ).toEqual([
      ["Working", 1, "running"],
      ["Finalizing", 3, "finalizing:result"],
      ["Completed", 3, "completed"],
    ]);
  });
});
