/**
 * Unsaved window edits, kept at module level next to the windows so leaving
 * /tasks loses nothing (wande's `TaskDraftsContext`). A detail window's draft
 * holds only the fields the person changed and has not saved; a field that is
 * absent shows the task's live value.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface TaskDraft {
  readonly title?: string;
  readonly description?: string;
  /** Create windows only: the chosen project; absent is the Inbox. */
  readonly projectId?: string;
}

const drafts = new Map<string, TaskDraft>();
const listeners = new Set<() => void>();
const EMPTY: TaskDraft = {};

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readDraft(key: string): TaskDraft {
  return drafts.get(key) ?? EMPTY;
}

export function updateDraft(key: string, patch: TaskDraft) {
  drafts.set(key, { ...drafts.get(key), ...patch });
  notify();
}

/** Drops fields once saved; the whole draft without `fields`. */
export function clearDraft(key: string, fields?: ReadonlyArray<keyof TaskDraft>) {
  const draft = drafts.get(key);
  if (!draft) return;
  if (!fields) drafts.delete(key);
  else {
    const next = { ...draft };
    for (const field of fields) delete next[field];
    drafts.set(key, next);
  }
  notify();
}

export function useDraft(key: string) {
  const draft = useSyncExternalStore(
    subscribe,
    () => readDraft(key),
    () => readDraft(key),
  );
  const update = useCallback((patch: TaskDraft) => updateDraft(key, patch), [key]);
  return [draft, update] as const;
}
