import { KeyboardIcon, Settings2Icon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarProvider } from "../ui/sidebar";
import { SettingsNavigationMenu } from "./SettingsSidebarNav";
import type { SettingsNavigationEntry } from "./settingsNavigation";

const ENTRIES: SettingsNavigationEntry[] = [
  { key: "/settings/general", label: "General", to: "/settings/general", icon: Settings2Icon },
  {
    key: "/settings/keybindings",
    label: "Keybindings",
    to: "/settings/keybindings",
    icon: KeyboardIcon,
  },
];

function renderMenu(pathname: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SettingsNavigationMenu entries={ENTRIES} pathname={pathname} onSelect={() => {}} />
    </SidebarProvider>,
  );
}

describe("SettingsNavigationMenu", () => {
  it("renders the sections as plain 32px sidebar rows with an icon and a label", () => {
    const html = renderMenu("/settings");

    expect(html.match(/data-slot="sidebar-menu-button"/g)).toHaveLength(2);
    expect(html).toContain("h-8 gap-2 px-2");
    expect(html).toContain("lucide-settings2");
    expect(html).toContain(">General</span>");
    expect(html).toContain(">Keybindings</span>");
  });

  it("has no card, dividers or trailing chevrons, as on the old phone list", () => {
    const html = renderMenu("/settings");

    expect(html).not.toContain("rounded-xl");
    expect(html).not.toContain("border-b");
    expect(html).not.toContain("lucide-chevron-right");
  });

  it("marks only the current section active", () => {
    expect(renderMenu("/settings")).not.toContain('data-active="true"');
    expect(renderMenu("/settings/keybindings").match(/data-active="true"/g)).toHaveLength(1);
  });
});
