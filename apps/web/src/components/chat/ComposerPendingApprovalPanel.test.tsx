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

describe("ComposerPendingApprovalActions options", () => {
  it("shows only the approval choices advertised by an MCP server", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-safari")}
        isResponding={false}
        options={[
          { decision: "decline", label: "Decline" },
          { decision: "acceptAlways", label: "Always allow Safari" },
          { decision: "accept", label: "Approve" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain("Always allow Safari");
    expect(markup).toContain(">Approve<");
    expect(markup).not.toContain("Always allow this session");
    expect(markup).not.toContain("Cancel turn");
  });

  it("limits provider-supplied approval labels so narrow rows can wrap", () => {
    const label = "Allow ".repeat(40).trim();
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-long-label")}
        isResponding={false}
        options={[{ decision: "acceptAlways", label }]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain('class="max-w-40 truncate"');
    expect(markup).toContain(label);
  });
});

describe("ComposerPendingApprovalPanel app access", () => {
  it("shows the app name and message for an MCP access request", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-safari"),
          requestKind: "mcp-elicitation",
          createdAt: "2026-08-24T00:00:00.000Z",
          appName: "Safari",
          detail: "Allow ChatGPT to use Safari?",
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain("App access approval requested");
    expect(markup).toContain('aria-label="App access request"');
    expect(markup).toContain(">Safari<");
    expect(markup).toContain("Allow ChatGPT to use Safari?");
  });

  it("limits long app names so the complete approval message stays readable", () => {
    const appName = "A".repeat(200);
    const detail = "Allow ChatGPT to access the selected application?";
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-long-app-name"),
          requestKind: "mcp-elicitation",
          createdAt: "2026-08-24T00:00:00.000Z",
          appName,
          detail,
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain("max-w-32 shrink truncate");
    expect(markup).toContain(appName);
    expect(markup).toContain('data-approval-detail="complete"');
    expect(markup).toContain(detail);
  });
});
