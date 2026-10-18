import { useSyncExternalStore } from "react";

// UpComputer: drafts whose first message is on screen while the server has not
// reported their thread yet. The sidebar would say "No threads yet" beside it
// until the thread arrives. The draft's route leaves once it does, so an entry
// only needs clearing when the send fails.
const sendingDraftIds = new Set<string>();
const listeners = new Set<() => void>();

export function setDraftFirstSendPending(draftId: string, pending: boolean): void {
  if (sendingDraftIds.has(draftId) === pending) return;
  if (pending) sendingDraftIds.add(draftId);
  else sendingDraftIds.delete(draftId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDraftFirstSendPending(draftId: string | null): boolean {
  const read = () => draftId !== null && sendingDraftIds.has(draftId);
  return useSyncExternalStore(subscribe, read, read);
}
