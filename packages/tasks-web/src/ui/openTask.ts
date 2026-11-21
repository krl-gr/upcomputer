import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useSyncExternalStore, type MouseEvent } from "react";

import { useComposerDraftStore } from "../../../../apps/web/src/composerDraftStore.ts";
import { rightPanelHostRef, useRightPanelStore } from "../../../../apps/web/src/rightPanelStore.ts";
import { resolveThreadRouteTarget } from "../../../../apps/web/src/threadRoutes.ts";
import { taskKey } from "./shared.ts";

// The task each chat's Tasks panel shows, by the panel's thread key. Module state, so a task
// opened from the chat reaches a panel that is not mounted yet.
const panelTaskKeys = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const readPanelTaskKey = (panelRef: ScopedThreadRef) =>
  panelTaskKeys.get(scopedThreadKey(panelRef));

export function setPanelTaskKey(panelRef: ScopedThreadRef, key: string | undefined) {
  const threadKey = scopedThreadKey(panelRef);
  if (panelTaskKeys.get(threadKey) === key) return;
  if (key === undefined) panelTaskKeys.delete(threadKey);
  else panelTaskKeys.set(threadKey, key);
  for (const listener of listeners) listener();
}

export function usePanelTaskKey(panelRef: ScopedThreadRef) {
  const read = () => readPanelTaskKey(panelRef);
  return useSyncExternalStore(subscribe, read, read);
}

/** Opens a task in `chatRef`'s Tasks panel, which a side chat shares with its parent. */
export function openTaskInPanel(
  chatRef: ScopedThreadRef,
  environmentId: EnvironmentId,
  taskId: string,
) {
  setPanelTaskKey(rightPanelHostRef(chatRef), taskKey({ environmentId, id: taskId }));
  useRightPanelStore.getState().openFeature(chatRef, "tasks");
}

/**
 * Opens a task beside the chat on screen, or on the Tasks page where there is none. The link
 * still goes to the Tasks page, so a modified or middle click opens it there.
 */
export function useOpenTask() {
  const router = useRouter();
  const navigate = useNavigate();
  const chatRef = (): ScopedThreadRef | null => {
    const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    if (target?.kind !== "draft") return target?.threadRef ?? null;
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
    return draft ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId)) : null;
  };
  const open = (environmentId: EnvironmentId, taskId: string) => {
    const ref = chatRef();
    if (ref) openTaskInPanel(ref, environmentId, taskId);
    else void navigate(taskPageLink(environmentId, taskId) as never);
  };
  return {
    open,
    linkProps: (environmentId: EnvironmentId, taskId: string) => ({
      ...taskPageLink(environmentId, taskId),
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        open(environmentId, taskId);
      },
    }),
  };
}

const taskPageLink = (environmentId: EnvironmentId, taskId: string) => ({
  to: "/tasks" as string,
  search: { task: taskKey({ environmentId, id: taskId }) } as never,
});
