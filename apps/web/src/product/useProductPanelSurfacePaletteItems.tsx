import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { useRightPanelStore } from "~/rightPanelStore";
import type { ThreadRouteTarget } from "~/threadRoutes";
import { useShownProductRightPanelSurfaces } from "./ProductSlots";

/** The chat whose panel opens: a saved thread, or a new thread's draft, as the panel menu does. */
function chatRef(target: ThreadRouteTarget): ScopedThreadRef | null {
  if (target.kind !== "draft") return target.threadRef;
  const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
  return draft ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId)) : null;
}

/**
 * "Open {label} in the panel" for each feature surface the right panel's menu
 * shows, beside the thread on screen. Settings hides an entry here too.
 */
export function useProductPanelSurfacePaletteItems(): CommandPaletteActionItem[] {
  const gt = useGT();
  const m = useMessages();
  const target = useThreadRouteTarget();
  const surfaces = useShownProductRightPanelSurfaces();
  if (target === null) return [];
  return surfaces.map((surface) => {
    const label = m(surface.label);
    const Icon = surface.icon;
    return {
      kind: "action",
      value: `action:open-panel-surface:${surface.id}`,
      searchTerms: [label, "panel", "side panel", "open"],
      title: gt("Open {label} in the panel", { label }),
      icon: <Icon className={ITEM_ICON_CLASS} />,
      run: async () => {
        const ref = chatRef(target);
        if (ref) useRightPanelStore.getState().openFeature(ref, surface.id);
      },
    };
  });
}
