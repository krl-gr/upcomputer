import { describe, expect, it } from "vite-plus/test";

import { workerThreadFilePath } from "./workerThreadFile.ts";

describe("workerThreadFilePath", () => {
  it("opens a file inside the thread's workspace relative and any other file by host path", () => {
    expect(workerThreadFilePath("/repo/src/app.ts", "/repo")).toBe("src/app.ts");
    // A worktree thread: the task's project folder is outside its workspace.
    expect(workerThreadFilePath("/repo/src/app.ts", "/worktrees/repo-fix")).toBe(
      "/repo/src/app.ts",
    );
    expect(workerThreadFilePath("/repo", "/repo")).toBe("/repo");
    expect(workerThreadFilePath("/repo/src/app.ts", undefined)).toBe("/repo/src/app.ts");
  });
});
