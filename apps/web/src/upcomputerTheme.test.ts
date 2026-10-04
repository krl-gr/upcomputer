import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BUILT_IN_THEME_IDS } from "@t3tools/shared/themePalettes";

import {
  DEFAULT_THEME_PREFERENCE,
  getThemeColorsForMode,
  getThemeDefinition,
  getThemeModes,
  installCustomTheme,
  isKnownThemePreference,
  isReservedThemeId,
  parseThemeFile,
  resolveThemeAppearance,
  T3_CHAT_THEME,
  THEME_COLOR_ROLES,
  THEME_FILE_VERSION,
  themeAllowsSidebarArtwork,
  themeColorToHex,
  toCanonicalThemeColor,
  UPCOMPUTER_THEME,
} from "./themePalette";

function asHex(value: string): string {
  const hex = themeColorToHex(value);
  if (!hex) throw new Error(`Expected a theme color, received ${value}`);
  return hex.slice(0, 7);
}

function contrastRatio(first: string, second: string): number {
  const luminance = (value: string) =>
    [1, 3, 5]
      .map((offset) => Number.parseInt(asHex(value).slice(offset, offset + 2), 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(entries));
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, value),
  };
}

async function loadThemeHook(entries: Record<string, string> = {}) {
  vi.stubGlobal("window", { localStorage: memoryStorage(entries) });
  return import("./hooks/useTheme");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("Up.computer theme", () => {
  it("is a built-in with a reserved id, alongside the upstream library", () => {
    expect(getThemeDefinition(UPCOMPUTER_THEME.id)).toBe(UPCOMPUTER_THEME);
    expect(UPCOMPUTER_THEME.label).toBe("Up.computer");
    expect(isKnownThemePreference(UPCOMPUTER_THEME.id)).toBe(true);
    expect(isReservedThemeId(UPCOMPUTER_THEME.id)).toBe(true);
    // Mobile renders BUILT_IN_THEME_IDS, which this theme stays out of.
    expect(BUILT_IN_THEME_IDS).not.toContain(UPCOMPUTER_THEME.id);
    for (const id of BUILT_IN_THEME_IDS) expect(getThemeDefinition(id)?.id).toBe(id);

    expect(() => installCustomTheme({ ...UPCOMPUTER_THEME, label: "Mine" })).toThrow(
      'The theme id "upcomputer" is reserved.',
    );
    expect(() =>
      parseThemeFile({
        version: THEME_FILE_VERSION,
        id: UPCOMPUTER_THEME.id,
        name: "Impostor",
        appearance: "light",
        colors: { canvas: "#ffffff" },
      }),
    ).toThrow('The theme id "upcomputer" is reserved.');
  });

  it("is the default for a fresh install and follows the OS appearance", async () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe(UPCOMPUTER_THEME.id);

    const fresh = await loadThemeHook();
    const theme = fresh.readThemePreference();
    expect(theme).toBe(UPCOMPUTER_THEME.id);
    const mode = fresh.readAppearanceModePreference(theme);
    expect(mode).toBe("system");
    expect(resolveThemeAppearance(theme, true, true, mode)).toBe("dark");
    expect(resolveThemeAppearance(theme, false, true, mode)).toBe("light");
  });

  it("replaces a preference that no longer resolves", async () => {
    const hook = await loadThemeHook({ "t3code:theme": "removed-custom-theme" });
    expect(hook.readThemePreference()).toBe(UPCOMPUTER_THEME.id);
  });

  it("keeps explicit choices, including the stock look and upstream themes", async () => {
    for (const stored of ["system", "light", "dark", T3_CHAT_THEME.id]) {
      vi.resetModules();
      const hook = await loadThemeHook({ "t3code:theme": stored });
      expect(hook.readThemePreference()).toBe(stored);
    }
    vi.resetModules();
    const pinned = await loadThemeHook({
      "t3code:theme": UPCOMPUTER_THEME.id,
      "t3code:theme-appearance-mode": "dark",
    });
    expect(pinned.readAppearanceModePreference(UPCOMPUTER_THEME.id)).toBe("dark");
  });

  it("defines every role in canonical OKLCH for light and dark", () => {
    expect(getThemeModes(UPCOMPUTER_THEME)).toEqual(["light", "dark"]);
    for (const mode of ["light", "dark"] as const) {
      const colors = getThemeColorsForMode(UPCOMPUTER_THEME, mode)!;
      expect(Object.keys(colors).toSorted()).toEqual([...THEME_COLOR_ROLES].toSorted());
      for (const value of Object.values(colors)) {
        expect(toCanonicalThemeColor(value)).toBe(value);
      }
    }
    // No artwork is drawn for this palette; the sidebar uses the pill fallback.
    expect(themeAllowsSidebarArtwork(UPCOMPUTER_THEME.id)).toBe(false);
  });

  it("keeps the V1 surfaces and sidebar states", () => {
    const light = UPCOMPUTER_THEME.colors;
    const dark = UPCOMPUTER_THEME.variants!.dark!;
    const expectations = [
      [light, { canvas: "#fefefe", sidebar: "#fdfdfd", sidebarBorder: "#e4e4e4" }],
      [dark, { canvas: "#131313", sidebar: "#131313", sidebarBorder: "#2b2b2b" }],
    ] as const;
    for (const [colors, expected] of expectations) {
      for (const [role, value] of Object.entries(expected)) {
        expect(asHex(colors[role as keyof typeof colors])).toBe(value);
      }
    }
    expect(asHex(light.sidebarRowSelected)).toBe("#f0f0f0");
    expect(asHex(dark.sidebarRowSelected)).toBe("#242424");
    expect(asHex(light.codeBackground)).toBe("#f0f0f0");
    expect(asHex(dark.codeBackground)).toBe("#1c1c1c");
    for (const colors of [light, dark]) {
      // One tone for every row state, and sidebar labels at full strength.
      expect(colors.sidebarRowHover).toBe(colors.sidebarRowSelected);
      expect(colors.sidebarRowActive).toBe(colors.sidebarRowSelected);
      expect(colors.sidebarControlSurface).toBe(colors.sidebarRowSelected);
      expect(colors.sidebarMutedForeground).toBe(colors.sidebarForeground);
    }
  });

  it("passes the contrast floors upstream holds its built-in palettes to", () => {
    for (const mode of ["light", "dark"] as const) {
      const colors = getThemeColorsForMode(UPCOMPUTER_THEME, mode)!;
      expect(contrastRatio(colors.text, colors.canvas)).toBeGreaterThanOrEqual(7);
      const pairs = [
        ["textMuted", "canvas"],
        ["accentForeground", "accent"],
        ["toolbarControlForeground", "toolbarControl"],
        ["messageForeground", "messageSurface"],
        ["messageActionForeground", "messageAction"],
        ["messageActionForeground", "messageActionHover"],
        ["mutedForeground", "muted"],
        ["placeholder", "surfaceRaised"],
        ["secondaryForeground", "secondary"],
        ["accentSurfaceForeground", "accentSurface"],
        ["sidebarForeground", "sidebar"],
        ["sidebarMutedForeground", "sidebar"],
        ["sidebarForeground", "sidebarRowSelected"],
        ["codeForeground", "codeBackground"],
        ["errorForeground", "errorSurface"],
        ["warningForeground", "warningSurface"],
        ["updateForeground", "updateSurface"],
      ] as const;
      for (const [foreground, background] of pairs) {
        expect(
          contrastRatio(colors[foreground], colors[background]),
          `${mode} ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
