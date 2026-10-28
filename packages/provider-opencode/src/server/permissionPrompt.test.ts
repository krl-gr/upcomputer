import { describe, expect, it } from "vite-plus/test";
import { openCodePermissionPrompt } from "./permissionPrompt.ts";

describe("OpenCode permission prompt", () => {
  it("keeps the commands and paths native tools name", () => {
    expect(openCodePermissionPrompt({ permission: "bash", patterns: ["git status"] }, {})).toBe(
      "git status",
    );
    expect(openCodePermissionPrompt({ permission: "edit", patterns: [] }, undefined)).toBe("edit");
  });

  it("names an MCP tool and its arguments instead of the wildcard", () => {
    expect(
      openCodePermissionPrompt(
        { permission: "t3-code_bot_remember", patterns: ["*"] },
        { id: "favorite-color", text: "The user's favorite color\nis teal", scope: null },
      ),
    ).toBe("t3-code_bot_remember\nid: favorite-color\ntext: The user's favorite color is teal");
    expect(
      openCodePermissionPrompt(
        { permission: "t3-code_task_get", patterns: ["*"] },
        { id: "task-1" },
      ),
    ).toBe("t3-code_task_get\nid: task-1");
    expect(openCodePermissionPrompt({ permission: "t3-code_task_get", patterns: ["*"] }, {})).toBe(
      "t3-code_task_get",
    );
  });

  it("keeps a long argument short", () => {
    const prompt = openCodePermissionPrompt(
      { permission: "t3-code_task_create", patterns: ["*"] },
      { description: "x".repeat(1000), tags: ["a", "b"] },
    );
    expect(prompt.length).toBeLessThan(300);
    expect(prompt).toContain('tags: ["a","b"]');
  });
});
