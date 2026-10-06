import type * as Electron from "electron";

/*
 * V1's macOS sidebar vibrancy. On darwin the main window is created transparent
 * over the native "sidebar" material, which stays active when the window is not
 * focused. A transparent window cannot turn opaque later, so the page decides
 * what shows through: the web app's `sidebarVibrancy` surface lets it through
 * the sidebar with the Up.computer theme, and every other theme paints the page
 * opaque. Other platforms keep upstream's opaque window.
 *
 * Before the first paint nothing shows: the window opens on `ready-to-show`,
 * after the boot splash has painted the theme's chrome color.
 */

type WindowVibrancyOptions = Required<
  Pick<
    Electron.BrowserWindowConstructorOptions,
    "backgroundColor" | "transparent" | "vibrancy" | "visualEffectState"
  >
>;

const TRANSPARENT_WINDOW_BACKGROUND = "#00000000";

/** The main window's creation options for vibrancy, or `null` where it stays opaque. */
export function upcomputerWindowVibrancyOptions(
  platform: NodeJS.Platform,
): WindowVibrancyOptions | null {
  if (platform !== "darwin") return null;
  return {
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    transparent: true,
    vibrancy: "sidebar",
    visualEffectState: "active",
  };
}

/**
 * The background color the main window keeps on appearance changes. Setting an
 * opaque color on a vibrant window would also make its page opaque.
 */
export function upcomputerWindowBackgroundColor(
  platform: NodeJS.Platform,
  opaqueColor: string,
): string {
  return upcomputerWindowVibrancyOptions(platform)?.backgroundColor ?? opaqueColor;
}
