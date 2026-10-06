import {
  isProductKeybindingCommandShown,
  isProductRightPanelSurfaceShown,
  isProductSettingsSearchItemShown,
  type ProductFlag,
  type ProductSurface,
  type ProductSurfaceVariant,
} from "@t3tools/shared/productFlags";

import { WEB_PRODUCT } from "./productEntry";

/*
 * Hooks for upstream UI behind a product flag (`@t3tools/shared/productFlags`).
 * Upstream state modules import these, so they read the product lazily, never
 * at module load.
 */

export function isProductFeatureShown(flag: ProductFlag): boolean {
  return WEB_PRODUCT.flags[flag];
}

/**
 * Where `terminal.new`, `terminal.split*` and `terminal.close` act, whatever
 * the shortcut's `when` says: a focused right-panel terminal, else the drawer,
 * and without the drawer the right panel, so a shortcut never opens a hidden
 * drawer. null when neither terminal is shown.
 */
export function terminalCommandTarget(
  focusOwner: "drawer" | "right-panel" | null,
): "drawer" | "right-panel" | null {
  const { terminal, terminalSurface } = WEB_PRODUCT.flags;
  if (focusOwner === "right-panel" && terminalSurface) return "right-panel";
  if (terminal) return "drawer";
  return terminalSurface ? "right-panel" : null;
}

/** Which version of a replaceable UI surface this build shows. */
export function productSurface(surface: ProductSurface): ProductSurfaceVariant {
  return WEB_PRODUCT.surfaces[surface];
}

/** Drops the keybindings of hidden features, so their shortcuts, labels and settings rows go too. */
export function withoutHiddenProductKeybindings<
  Bindings extends ReadonlyArray<{ readonly command: string }>,
>(bindings: Bindings): Bindings {
  const flags = WEB_PRODUCT.flags;
  return bindings.filter((binding) =>
    isProductKeybindingCommandShown(flags, binding.command),
  ) as unknown as Bindings;
}

export function isProductKeybindingShown(command: string): boolean {
  return isProductKeybindingCommandShown(WEB_PRODUCT.flags, command);
}

// Settings rows that only one version of a surface has.
const SURFACE_SETTINGS_SEARCH_IDS: Partial<
  Record<string, readonly [ProductSurface, ProductSurfaceVariant]>
> = {
  "thread-list": ["sidebarThreadRow", "upcomputer"],
  // The UpComputer composer never collapses on scroll.
  "composer-collapse": ["composerFooter", "upstream"],
};

export function isProductSettingsSearchItemVisible(item: { readonly id: string }): boolean {
  const owner = SURFACE_SETTINGS_SEARCH_IDS[item.id];
  if (owner && WEB_PRODUCT.surfaces[owner[0]] !== owner[1]) return false;
  return isProductSettingsSearchItemShown(WEB_PRODUCT.flags, item.id);
}

/** Right-panel launcher entries without the hidden features' surfaces. */
export function withoutHiddenProductSurfaces<Action extends { readonly label: string }>(
  actions: ReadonlyArray<Action>,
): ReadonlyArray<Action> {
  const flags = WEB_PRODUCT.flags;
  return actions.filter((action) => isProductRightPanelSurfaceShown(flags, action.label));
}
