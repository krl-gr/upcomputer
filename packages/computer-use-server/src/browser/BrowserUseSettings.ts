import { BROWSER_FOR_AGENTS, type BrowserForAgents } from "@t3tools/computer-use-contracts/rpc";

import { readSettingsSections } from "../settings/ComputerUseSettingsFile.ts";

/**
 * Today's behavior, until the Windows checks pass. Switching the default to
 * Automatic is this one line: `"automatic"`.
 */
export const DEFAULT_BROWSER_FOR_AGENTS: BrowserForAgents = "builtin";

export interface BrowserUseSettings {
  /** Which browser runs the preview_* tools: see `chromeForAgents` for Automatic. */
  readonly browserForAgents: BrowserForAgents;
}

const isBrowserForAgents = (value: unknown): value is BrowserForAgents =>
  (BROWSER_FOR_AGENTS as ReadonlyArray<unknown>).includes(value);

/**
 * Reads the `browser` settings section; read on every preview call. An
 * explicit "Always use Chrome" from before the choice keeps what it meant:
 * on is Always Chrome, off is Always built-in.
 */
export async function readBrowserUseSettings(settingsPath: string): Promise<BrowserUseSettings> {
  const { browser } = await readSettingsSections(settingsPath);
  const section =
    typeof browser === "object" && browser !== null
      ? (browser as { readonly browserForAgents?: unknown; readonly alwaysUseChrome?: unknown })
      : {};
  if (isBrowserForAgents(section.browserForAgents)) {
    return { browserForAgents: section.browserForAgents };
  }
  if (typeof section.alwaysUseChrome === "boolean") {
    return { browserForAgents: section.alwaysUseChrome ? "chrome" : "builtin" };
  }
  return { browserForAgents: DEFAULT_BROWSER_FOR_AGENTS };
}

/** The `browser` section to save; `alwaysUseChrome` keeps an older server reading it right. */
export const browserUseSettingsSection = (browserForAgents: BrowserForAgents) => ({
  browserForAgents,
  alwaysUseChrome: browserForAgents === "chrome",
});
