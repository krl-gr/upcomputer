import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import {
  addPendingProjectLink,
  removePendingProjectLink,
  type ScopedProjectLink,
} from "./lib/threadProjectLinks";

/**
 * Projects a draft should link once its first send creates the thread
 * (picked through `@project` or the context bar before the thread exists).
 * Keyed by draft id, which stays stable when the draft changes project.
 */
interface PendingProjectLinksState {
  byDraftId: Record<string, ReadonlyArray<ScopedProjectLink>>;
  addLink: (draftId: string, link: ScopedProjectLink) => void;
  removeLink: (draftId: string, link: ScopedProjectLink) => void;
  clearDraft: (draftId: string) => void;
}

const EMPTY_LINKS: ReadonlyArray<ScopedProjectLink> = [];

export const usePendingProjectLinksStore = create<PendingProjectLinksState>()(
  persist(
    (set) => ({
      byDraftId: {},
      addLink: (draftId, link) =>
        set((state) => {
          const current = state.byDraftId[draftId] ?? EMPTY_LINKS;
          const next = addPendingProjectLink(current, link);
          return next === current ? state : { byDraftId: { ...state.byDraftId, [draftId]: next } };
        }),
      removeLink: (draftId, link) =>
        set((state) => {
          const current = state.byDraftId[draftId];
          if (!current) return state;
          const next = removePendingProjectLink(current, link);
          if (next === current) return state;
          const { [draftId]: _removed, ...rest } = state.byDraftId;
          return { byDraftId: next.length > 0 ? { ...rest, [draftId]: next } : rest };
        }),
      clearDraft: (draftId) =>
        set((state) => {
          if (!(draftId in state.byDraftId)) return state;
          const { [draftId]: _removed, ...rest } = state.byDraftId;
          return { byDraftId: rest };
        }),
    }),
    {
      name: "upcomputer:pending-project-links:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byDraftId: state.byDraftId }),
    },
  ),
);

export function selectPendingProjectLinks(
  state: PendingProjectLinksState,
  draftId: string | null | undefined,
): ReadonlyArray<ScopedProjectLink> {
  return (draftId ? state.byDraftId[draftId] : undefined) ?? EMPTY_LINKS;
}
