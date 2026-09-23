import { scopeThreadRef } from "@upcomputer/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@upcomputer/contracts";

import { DraftId } from "../composerDraftStore";
import {
  isChatWorkspacePanelId,
  type ChatWorkspacePanelId,
  type ChatWorkspacePanelState,
} from "./workspacePanelIds";

export const CHAT_WORKSPACE_STORAGE_KEY = "upcomputer:chat-workspace:v1";

export interface PersistedChatWorkspaceStateV1 {
  version: 1;
  dockview: unknown | null;
  panelsById: Record<ChatWorkspacePanelId, ChatWorkspacePanelState>;
  activePanelId: ChatWorkspacePanelId | null;
}

export const EMPTY_CHAT_WORKSPACE_STATE: PersistedChatWorkspaceStateV1 = {
  version: 1,
  dockview: null,
  panelsById: {},
  activePanelId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parsePanelState(value: unknown): ChatWorkspacePanelState | null {
  if (!isRecord(value)) return null;
  if (value.kind === "empty") return { kind: "empty" };
  if (value.kind !== undefined && value.kind !== "chat") return null;
  if (!isRecord(value.target)) return null;

  const ref = isRecord(value.target.ref) ? value.target.ref : null;
  const environmentId = parseString(ref?.environmentId);
  const threadId = parseString(ref?.threadId);
  if (!environmentId || !threadId) return null;
  const scopedRef = scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId);

  if (value.target.kind === "thread") {
    return { kind: "chat", target: { kind: "thread", ref: scopedRef } };
  }
  if (value.target.kind === "draft") {
    const draftId = parseString(value.target.draftId);
    return draftId
      ? { kind: "chat", target: { kind: "draft", draftId: DraftId.make(draftId), ref: scopedRef } }
      : null;
  }
  return null;
}

export function sanitizePersistedChatWorkspaceState(value: unknown): PersistedChatWorkspaceStateV1 {
  if (!isRecord(value) || value.version !== 1) return EMPTY_CHAT_WORKSPACE_STATE;

  const panelsById: Record<ChatWorkspacePanelId, ChatWorkspacePanelState> = {};
  const rawPanels = isRecord(value.panelsById) ? value.panelsById : {};
  for (const [panelId, rawPanel] of Object.entries(rawPanels)) {
    if (!isChatWorkspacePanelId(panelId)) continue;
    const panelState = parsePanelState(rawPanel);
    if (panelState) panelsById[panelId] = panelState;
  }

  const activePanelId =
    typeof value.activePanelId === "string" && value.activePanelId in panelsById
      ? (value.activePanelId as ChatWorkspacePanelId)
      : null;

  return {
    version: 1,
    dockview: isRecord(value.dockview) ? value.dockview : null,
    panelsById,
    activePanelId,
  };
}

export function readPersistedChatWorkspaceState(): PersistedChatWorkspaceStateV1 {
  if (typeof window === "undefined") return EMPTY_CHAT_WORKSPACE_STATE;
  try {
    const raw = window.localStorage.getItem(CHAT_WORKSPACE_STORAGE_KEY);
    return raw ? sanitizePersistedChatWorkspaceState(JSON.parse(raw)) : EMPTY_CHAT_WORKSPACE_STATE;
  } catch {
    return EMPTY_CHAT_WORKSPACE_STATE;
  }
}

export function writePersistedChatWorkspaceState(state: PersistedChatWorkspaceStateV1): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_WORKSPACE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence must never block the workspace.
  }
}
