import { ThreadId } from "@upcomputer/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadStatusLabel, ThreadWorktreeIndicator } from "./ThreadStatusIndicators";

describe("ThreadStatusLabel", () => {
  it("can preserve the status label while hiding its sidebar dot", () => {
    const markup = renderToStaticMarkup(
      <ThreadStatusLabel
        status={{
          label: "Completed",
          colorClass: "text-success",
          dotClass: "bg-success",
          pulse: false,
        }}
        showDot={false}
      />,
    );

    expect(markup).toContain("Completed");
    expect(markup).not.toContain("rounded-full");
    expect(markup).not.toContain("bg-success");
  });
});

describe("ThreadWorktreeIndicator", () => {
  it("renders the worktree folder and branch in an accessible label", () => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "feature/sidebar-indicator",
          worktreePath: "/tmp/worktrees/sidebar-indicator",
        }}
      />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'aria-label="Worktree: sidebar-indicator (feature/sidebar-indicator)"',
    );
    expect(markup).toContain('data-testid="thread-worktree-thread-1"');
  });

  it.each([null, "", "   "])("renders nothing for an absent worktree path", (worktreePath) => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "main",
          worktreePath,
        }}
      />,
    );

    expect(markup).toBe("");
  });
});
