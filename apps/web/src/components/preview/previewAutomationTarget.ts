import type {
  EnvironmentId,
  PreviewAutomationOperation,
  PreviewSessionSnapshot,
  ThreadId,
} from "@upcomputer/contracts";

import { PreviewAutomationTargetUnavailableError } from "./previewAutomationErrors";

interface PreviewAutomationSessionIndex {
  readonly snapshot: PreviewSessionSnapshot | null;
  readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
}

export function requirePreviewAutomationTarget<T>(
  state: PreviewAutomationSessionIndex,
  bridge: T | null,
  tabId: string | null,
  context: {
    readonly requestId: string;
    readonly operation: PreviewAutomationOperation;
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  },
): { readonly bridge: T; readonly tabId: string } {
  if (!bridge || !tabId || state.sessions[tabId] === undefined) {
    throw new PreviewAutomationTargetUnavailableError({
      ...context,
      tabId,
      bridgeAvailable: Boolean(bridge),
    });
  }
  return { bridge, tabId };
}

export function needsPreviewAutomationSessionSync(
  state: PreviewAutomationSessionIndex,
  requestedTabId: string | undefined,
): boolean {
  return (
    Object.keys(state.sessions).length === 0 ||
    requestedTabId === undefined ||
    state.sessions[requestedTabId] === undefined
  );
}

export function resolvePreviewAutomationTarget(
  state: PreviewAutomationSessionIndex,
  requestedTabId: string | null,
): { readonly tabId: string | null; readonly snapshot: PreviewSessionSnapshot | null } {
  const snapshot = requestedTabId ? (state.sessions[requestedTabId] ?? null) : state.snapshot;
  return { tabId: snapshot?.tabId ?? null, snapshot };
}

export function resolvePreviewAutomationOpenTab(
  state: PreviewAutomationSessionIndex,
  requestedTabId: string | undefined,
  reuseExistingTab: boolean,
): string | null {
  if (!reuseExistingTab) return null;
  if (requestedTabId !== undefined) {
    return state.sessions[requestedTabId]?.tabId ?? null;
  }
  return state.snapshot?.tabId ?? null;
}
