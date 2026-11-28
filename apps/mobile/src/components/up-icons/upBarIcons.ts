import type { ImageSourcePropType } from "react-native";

import type { UpIconName } from "./upIconData";
import { upIconOfSymbol } from "./upSymbol";

/**
 * Native header buttons take images, not SVG: these icons as 24pt template PNGs, rendered from the
 * same iconmcp SVGs with a 1.5pt line. Native menu items still take SF Symbol names only.
 */
const UP_BAR_ICONS = {
  "chevron-left": require("../../../assets/up-icons/chevron-left.png"),
  filter: require("../../../assets/up-icons/filter.png"),
  "more-horizontal": require("../../../assets/up-icons/more-horizontal.png"),
  "panel-bottom": require("../../../assets/up-icons/panel-bottom.png"),
  plus: require("../../../assets/up-icons/plus.png"),
  "sidebar-right": require("../../../assets/up-icons/sidebar-right.png"),
  sliders: require("../../../assets/up-icons/sliders.png"),
} satisfies Partial<Record<UpIconName, ImageSourcePropType>>;

type UpBarIconName = keyof typeof UP_BAR_ICONS;

export function upBarIcon(name: UpBarIconName) {
  return { type: "image" as const, source: UP_BAR_ICONS[name] as ImageSourcePropType };
}

/** A header button's icon for an `up.*` symbol name that has a bar image. */
export function upBarIconOfSymbol(symbol: string) {
  const icon = upIconOfSymbol(symbol);
  return icon !== null && icon in UP_BAR_ICONS ? upBarIcon(icon as UpBarIconName) : undefined;
}
