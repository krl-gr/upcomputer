import { UP_ICONS, type UpIconName } from "./upIconData";

/**
 * An iconmcp icon named where upstream components take a symbol name (`icon="up.plus"`):
 * `SymbolView` draws it with `UpIcon`, and native header buttons use its template image.
 */
export type UpSymbolName = `up.${UpIconName}`;

export function upIconOfSymbol(name: string): UpIconName | null {
  if (!name.startsWith("up.")) return null;
  const icon = name.slice(3);
  return Object.prototype.hasOwnProperty.call(UP_ICONS, icon) ? (icon as UpIconName) : null;
}

export function upSymbol(icon: UpIconName): UpSymbolName {
  return `up.${icon}`;
}
