import { readSettingsSections } from "../settings/ComputerUseSettingsFile.ts";

export interface BrowserUseSettings {
  /**
   * Run the preview_* browser tools in the managed Chrome even while the desktop
   * app's built-in browser is available, for sites that reject embedded browsers.
   */
  readonly alwaysUseChrome: boolean;
}

/** Reads the `browser` settings section; read on every preview call. */
export async function readBrowserUseSettings(settingsPath: string): Promise<BrowserUseSettings> {
  const { browser } = await readSettingsSections(settingsPath);
  const alwaysUseChrome =
    typeof browser === "object" &&
    browser !== null &&
    (browser as { readonly alwaysUseChrome?: unknown }).alwaysUseChrome === true;
  return { alwaysUseChrome };
}
