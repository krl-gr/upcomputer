import { useGT, useMessages } from "gt-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import { useThreadRouteRef } from "~/hooks/useThreadRouteTarget";
import { useRightPanelStore } from "~/rightPanelStore";
import { useShownProductRightPanelSurfaces } from "./ProductSlots";

/**
 * "Open {label} in the panel" for each feature surface the right panel's menu
 * shows, beside the thread on screen. Settings hides an entry here too.
 */
export function useProductPanelSurfacePaletteItems(): CommandPaletteActionItem[] {
  const gt = useGT();
  const m = useMessages();
  const threadRef = useThreadRouteRef();
  const surfaces = useShownProductRightPanelSurfaces();
  if (threadRef === null) return [];
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
        useRightPanelStore.getState().openFeature(threadRef, surface.id);
      },
    };
  });
}
