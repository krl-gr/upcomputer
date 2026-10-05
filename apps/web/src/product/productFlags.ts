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

export function isProductSettingsSearchItemVisible(item: { readonly id: string }): boolean {
  return isProductSettingsSearchItemShown(WEB_PRODUCT.flags, item.id);
}

/** Right-panel launcher entries without the hidden features' surfaces. */
export function withoutHiddenProductSurfaces<Action extends { readonly label: string }>(
  actions: ReadonlyArray<Action>,
): ReadonlyArray<Action> {
  const flags = WEB_PRODUCT.flags;
  return actions.filter((action) => isProductRightPanelSurfaceShown(flags, action.label));
}
