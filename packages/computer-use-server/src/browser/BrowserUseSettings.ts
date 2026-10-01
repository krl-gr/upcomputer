// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

export interface BrowserUseSettings {
  /**
   * Run the preview_* browser tools in the managed Chrome even while the desktop
   * app's built-in browser is available, for sites that reject embedded browsers.
   */
  readonly alwaysUseChrome: boolean;
}

/** Reads the `browser` section of the server settings file. */
export async function readBrowserUseSettings(settingsPath: string): Promise<BrowserUseSettings> {
  const raw = await NodeFSP.readFile(settingsPath, "utf8").catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { readonly browser?: { readonly alwaysUseChrome?: unknown } };
    return { alwaysUseChrome: parsed.browser?.alwaysUseChrome === true };
  } catch {
    return { alwaysUseChrome: false };
  }
}
