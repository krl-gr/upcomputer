import { isMacPlatform } from "../lib/utils";
import { productSurface } from "../product/productFlags";

/*
 * The `sidebarVibrancy` surface. The macOS desktop window is created with
 * native vibrancy (`apps/desktop/src/window/UpcomputerWindowVibrancy.ts`), and
 * this marks the document so `theme.upcomputer.css` can let it show through the
 * sidebar. The stylesheet also requires the Up.computer theme, so switching to
 * another theme at runtime paints the page opaque again without a reload.
 */

export const SIDEBAR_VIBRANCY_ATTRIBUTE = "data-upcomputer-sidebar-vibrancy";

/** Whether the Electron renderer on `platform` sits in a vibrant window. */
export function showsSidebarVibrancy(platform: string): boolean {
  return productSurface("sidebarVibrancy") === "upcomputer" && isMacPlatform(platform);
}

/** Marks the document of the Electron renderer; `main.tsx` calls it next to the `.electron` class. */
export function syncDocumentSidebarVibrancy(platform: string): () => void {
  if (typeof document === "undefined" || !showsSidebarVibrancy(platform)) {
    return () => {};
  }
  document.documentElement.setAttribute(SIDEBAR_VIBRANCY_ATTRIBUTE, "");
  return () => {
    document.documentElement.removeAttribute(SIDEBAR_VIBRANCY_ATTRIBUTE);
  };
}
