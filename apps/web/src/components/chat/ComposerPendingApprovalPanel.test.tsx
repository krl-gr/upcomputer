import { ApprovalRequestId } from "@upcomputer/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { PendingApproval } from "../../session-logic";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

const approval = (
  requestKind: PendingApproval["requestKind"],
  detail?: string,
): PendingApproval => ({
  requestId: "approval-1" as ApprovalRequestId,
  requestKind,
  createdAt: "2026-07-17T00:00:00.000Z",
  ...(detail === undefined ? {} : { detail }),
});

describe("ComposerPendingApprovalPanel", () => {
  it.each([
    ["command", "Command approval requested"],
    ["file-read", "File-read approval requested"],
    ["file-change", "File-change approval requested"],
  ] as const)("renders the %s approval summary", (requestKind, summary) => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel approval={approval(requestKind)} pendingCount={1} />,
    );

    expect(markup).toContain(summary);
    expect(markup).not.toContain("PENDING APPROVAL");
  });

  it("keeps approval detail visible beside the summary", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={approval("command", "Helium / element 6")}
        pendingCount={2}
      />,
    );

    expect(markup).toContain("Command approval requested:");
    expect(markup).toContain("Helium / element 6");
    expect(markup).toContain("1/2");
  });
});

describe("ComposerPendingApprovalActions", () => {
  it("renders all approval decisions with pill styling", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={"approval-1" as ApprovalRequestId}
        isResponding={false}
        onRespondToApproval={vi.fn()}
      />,
    );

    expect(markup).toContain("Cancel turn");
    expect(markup).toContain("Decline");
    expect(markup).toContain("Always allow this session");
    expect(markup).toContain("Approve once");
    expect(markup.match(/rounded-full/g)).toHaveLength(8);
  });
});

describe("ComposerPendingApprovalPanel", () => {
  it("renders complete multiline command details without hover or truncation", () => {
    const detail = `bun run release -- ${"long-argument ".repeat(20)}\nsecond line`;
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-1"),
          requestKind: "command",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail,
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain('data-approval-detail="complete"');
    expect(markup).toContain('aria-label="Command"');
    expect(markup).toContain(detail);
    expect(markup).not.toContain("truncate");
    expect(markup).not.toContain("line-clamp");
  });
});
