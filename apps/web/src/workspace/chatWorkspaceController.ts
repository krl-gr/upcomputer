import type { ScopedProjectRef, ScopedThreadRef } from "@upcomputer/contracts";
import { create } from "zustand";

import type { DraftId, DraftThreadEnvMode } from "../composerDraftStore";
import type { CreatedDraftThread } from "../hooks/useHandleNewThread";
import type { ChatWorkspacePanelId } from "./workspacePanelIds";

export type ChatWorkspaceOpenDisposition = "active-panel" | "new-panel" | "reserved-panel";

export type ChatWorkspaceOpenTarget =
  | { kind: "thread"; ref: ScopedThreadRef }
  | { kind: "draft"; draftId: DraftId; ref: ScopedThreadRef }
  | { kind: "empty" };

export interface ChatWorkspaceOpenRequest {
  target: ChatWorkspaceOpenTarget;
  disposition: ChatWorkspaceOpenDisposition;
  referenceGroupId?: string;
  panelId?: ChatWorkspacePanelId;
}

export interface ChatWorkspaceDraftThreadRequest {
  projectRef: ScopedProjectRef;
  options?: {
    branch?: string | null;
    worktreePath?: string | null;
    envMode?: DraftThreadEnvMode;
    startFromOrigin?: boolean;
  };
  disposition: Extract<ChatWorkspaceOpenDisposition, "active-panel" | "new-panel">;
  referenceGroupId?: string;
}

interface ChatWorkspaceController {
  openWorkspaceTarget: (request: ChatWorkspaceOpenRequest) => ChatWorkspacePanelId | null;
  createDraftThreadPanel: (request: ChatWorkspaceDraftThreadRequest) => CreatedDraftThread | null;
}

interface ChatWorkspaceControllerState {
  activePanelId: ChatWorkspacePanelId | null;
  controller: ChatWorkspaceController | null;
  registerController: (controller: ChatWorkspaceController) => () => void;
  setActivePanelId: (panelId: ChatWorkspacePanelId | null) => void;
}

export function resolveWorkspacePanelIdForOpenRequest(input: {
  activePanelId: ChatWorkspacePanelId | null;
  createPanelId: () => ChatWorkspacePanelId;
  hasPanel: (panelId: ChatWorkspacePanelId) => boolean;
  request: Pick<ChatWorkspaceOpenRequest, "disposition" | "panelId">;
}): ChatWorkspacePanelId {
  if (input.request.disposition === "reserved-panel") {
    const reserved = input.request.panelId;
    return reserved && input.hasPanel(reserved) ? reserved : input.createPanelId();
  }
  if (input.request.disposition === "active-panel") {
    const active = input.activePanelId;
    return active && input.hasPanel(active) ? active : input.createPanelId();
  }
  return input.createPanelId();
}

export const useChatWorkspaceControllerStore = create<ChatWorkspaceControllerState>((set, get) => ({
  activePanelId: null,
  controller: null,
  registerController: (controller) => {
    set({ controller });
    return () => {
      if (get().controller === controller) set({ controller: null, activePanelId: null });
    };
  },
  setActivePanelId: (activePanelId) => set({ activePanelId }),
}));

export function openChatWorkspaceTarget(request: ChatWorkspaceOpenRequest) {
  return (
    useChatWorkspaceControllerStore.getState().controller?.openWorkspaceTarget(request) ?? null
  );
}

export function createChatWorkspaceDraftThread(request: ChatWorkspaceDraftThreadRequest) {
  return (
    useChatWorkspaceControllerStore.getState().controller?.createDraftThreadPanel(request) ?? null
  );
}
