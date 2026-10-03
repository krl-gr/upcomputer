import { scopeThreadRef } from "@upcomputer/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "../composerDraftStore";
import { resolveWorkspacePanelIdForOpenRequest } from "./chatWorkspaceController";
import {
  createChatWorkspacePanelId,
  getChatWorkspaceRouteTargetKey,
  isChatWorkspacePanelId,
  type ChatWorkspacePanelId,
} from "./workspacePanelIds";

const ref = scopeThreadRef(EnvironmentId.make("environment-local"), ThreadId.make("thread-one"));

describe("workspacePanelIds", () => {
  it("creates and recognizes slot-scoped panel ids", () => {
    const panelId = createChatWorkspacePanelId();

    expect(panelId).toMatch(/^workspace:[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/);
    expect(isChatWorkspacePanelId(panelId)).toBe(true);
    expect(isChatWorkspacePanelId("workspace:")).toBe(false);
    expect(isChatWorkspacePanelId("chat:environment-local:thread-one")).toBe(false);
  });

  it("builds stable, kind-specific route keys", () => {
    const threadTarget = { target: { kind: "thread" as const, ref } };
    const draftTarget = {
      target: { kind: "draft" as const, draftId: DraftId.make("draft-one"), ref },
    };

    expect(getChatWorkspaceRouteTargetKey(threadTarget)).toBe(
      getChatWorkspaceRouteTargetKey({ target: { kind: "thread", ref } }),
    );
    expect(getChatWorkspaceRouteTargetKey(threadTarget)).not.toBe(
      getChatWorkspaceRouteTargetKey(draftTarget),
    );
  });

  it("reuses only the requested existing slot", () => {
    const active = "workspace:active" as ChatWorkspacePanelId;
    const reserved = "workspace:reserved" as ChatWorkspacePanelId;
    const created = "workspace:new" as ChatWorkspacePanelId;
    const hasPanel = (panelId: ChatWorkspacePanelId) => panelId === active || panelId === reserved;

    expect(
      resolveWorkspacePanelIdForOpenRequest({
        activePanelId: active,
        createPanelId: () => created,
        hasPanel,
        request: { disposition: "active-panel" },
      }),
    ).toBe(active);
    expect(
      resolveWorkspacePanelIdForOpenRequest({
        activePanelId: active,
        createPanelId: () => created,
        hasPanel,
        request: { disposition: "reserved-panel", panelId: reserved },
      }),
    ).toBe(reserved);
    expect(
      resolveWorkspacePanelIdForOpenRequest({
        activePanelId: active,
        createPanelId: () => created,
        hasPanel,
        request: { disposition: "new-panel" },
      }),
    ).toBe(created);
  });
});
