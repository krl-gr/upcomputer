import { EnvironmentId, ThreadId } from "@upcomputer/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ChatView", () => ({
  default: (props: { readonly isWorkspacePanelActive?: boolean }) =>
    createElement("div", {
      "data-workspace-panel-active": String(props.isWorkspacePanelActive),
    }),
}));

import { ChatWorkspacePanel } from "./ChatWorkspacePanel";

const panelState = {
  kind: "chat",
  target: {
    kind: "thread",
    ref: {
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    },
  },
} as const;

describe("ChatWorkspacePanel", () => {
  it("enables global interactions only for the active mounted panel", () => {
    const activeMarkup = renderToStaticMarkup(
      <ChatWorkspacePanel panelState={panelState} isActive />,
    );
    const inactiveMarkup = renderToStaticMarkup(
      <ChatWorkspacePanel panelState={panelState} isActive={false} />,
    );

    expect(activeMarkup).toContain('data-workspace-panel-active="true"');
    expect(inactiveMarkup).toContain('data-workspace-panel-active="false"');
  });
});
