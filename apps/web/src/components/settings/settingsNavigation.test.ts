import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_SETTINGS_SECTION_PATH,
  resolveSettingsIndexTarget,
  resolveSettingsNavigationEntries,
} from "./settingsNavigation";

const Icon = () => null;

describe("resolveSettingsNavigationEntries", () => {
  it("lists General, then product pages, then the other core sections", () => {
    const entries = resolveSettingsNavigationEntries({
      coreItems: [
        { label: "General", to: "/settings/general", icon: Icon },
        { label: "Keybindings", to: "/settings/keybindings", icon: Icon },
        { label: "Beta", to: "/settings/beta", icon: Icon, hideFromNavigation: true },
        { label: "Archive", to: "/settings/archived", icon: Icon },
      ],
      featurePages: [
        {
          feature: { id: "agent" },
          page: { id: "browser", label: "Browser", path: "/settings/browser" },
        },
        {
          feature: { id: "agent" },
          page: {
            id: "hidden",
            label: "Hidden",
            path: "/settings/hidden",
            hideFromNavigation: true,
          },
        },
      ],
    });
    expect(entries.map((entry) => [entry.key, entry.to])).toEqual([
      ["/settings/general", "/settings/general"],
      ["agent:browser", "/settings/browser"],
      ["/settings/keybindings", "/settings/keybindings"],
      ["/settings/archived", "/settings/archived"],
    ]);
  });
});

describe("resolveSettingsIndexTarget", () => {
  it("shows the section list on phones and opens General elsewhere", () => {
    expect(resolveSettingsIndexTarget({ isMobile: true })).toBe("section-list");
    expect(resolveSettingsIndexTarget({ isMobile: false })).toBe(DEFAULT_SETTINGS_SECTION_PATH);
  });
});
