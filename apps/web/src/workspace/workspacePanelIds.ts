import type { ScopedThreadRef } from "@upcomputer/contracts";

import type { DraftId } from "../composerDraftStore";
import { randomUUID } from "../lib/utils";

export type ChatWorkspacePanelId = `workspace:${string}`;

export type ChatWorkspacePanelTarget =
  | { kind: "thread"; ref: ScopedThreadRef }
  | { kind: "draft"; draftId: DraftId; ref: ScopedThreadRef };

export type ChatWorkspacePanelState =
  | { kind: "empty" }
  | { kind: "chat"; target: ChatWorkspacePanelTarget };

export interface ChatWorkspaceRouteTarget {
  target: ChatWorkspacePanelTarget;
}

export function getChatWorkspaceRouteTargetKey(target: ChatWorkspaceRouteTarget): string {
  return JSON.stringify([
    target.target.kind,
    target.target.ref.environmentId,
    target.target.ref.threadId,
    target.target.kind === "draft" ? target.target.draftId : null,
  ]);
}

export function isChatWorkspacePanelId(value: string): value is ChatWorkspacePanelId {
  return value.startsWith("workspace:") && value.length > "workspace:".length;
}

export function createChatWorkspacePanelId(): ChatWorkspacePanelId {
  return `workspace:${randomUUID()}`;
}
