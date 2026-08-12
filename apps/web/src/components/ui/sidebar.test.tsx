import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  Sidebar,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";
import { resolveSidebarState } from "./sidebarState";

function renderSidebarButton(className?: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenuButton className={className}>Projects</SidebarMenuButton>
    </SidebarProvider>,
  );
}

describe("sidebar interactive cursors", () => {
  it("uses mobile sheet visibility for the shared responsive state", () => {
    expect(resolveSidebarState({ isMobile: true, open: true, openMobile: false })).toBe(
      "collapsed",
    );
    expect(resolveSidebarState({ isMobile: true, open: false, openMobile: true })).toBe("expanded");
    expect(resolveSidebarState({ isMobile: false, open: true, openMobile: false })).toBe(
      "expanded",
    );
  });

  it("exposes collapsed state for shared titlebar inset styling", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider defaultOpen={false}>
        <div />
      </SidebarProvider>,
    );

    expect(html).toContain('data-sidebar-state="collapsed"');
  });

  it.each(["v1", "v2"] as const)(
    "renders the UpComputer %s theme scope on the sidebar surface",
    (version) => {
      const html = renderToStaticMarkup(
        <SidebarProvider>
          <Sidebar data-upcomputer-sidebar-version={version}>Navigation</Sidebar>
        </SidebarProvider>,
      );

      expect(html).toContain(`data-upcomputer-sidebar-version="${version}"`);
      expect(html).toContain('data-slot="sidebar-container"');
    },
  );

  it("keeps the sidebar trigger interactive inside Electron drag regions", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(html).toContain("[-webkit-app-region:no-drag]");
    expect(html).toContain("size-[var(--workspace-titlebar-control-size)]!");
  });

  it("uses a pointer cursor for menu buttons by default", () => {
    const html = renderSidebarButton();

    expect(html).toContain('data-slot="sidebar-menu-button"');
    expect(html).toContain("cursor-pointer");
  });

  it("lets project drag handles override the default pointer cursor", () => {
    const html = renderSidebarButton("cursor-grab");

    expect(html).toContain("cursor-grab");
    expect(html).not.toContain("cursor-pointer");
  });

  it("uses a pointer cursor for menu actions", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuAction aria-label="Create thread">
        <span>+</span>
      </SidebarMenuAction>,
    );

    expect(html).toContain('data-slot="sidebar-menu-action"');
    expect(html).toContain("cursor-pointer");
  });

  it("uses a pointer cursor for submenu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />}>Show more</SidebarMenuSubButton>,
    );

    expect(html).toContain('data-slot="sidebar-menu-sub-button"');
    expect(html).toContain("cursor-pointer");
  });

  it("uses shared row tokens for menu and submenu interaction states", () => {
    const menuHtml = renderSidebarButton();
    const submenuHtml = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />} isActive>
        Active thread
      </SidebarMenuSubButton>,
    );

    for (const html of [menuHtml, submenuHtml]) {
      expect(html).toContain("hover:bg-sidebar-row-hover");
      expect(html).toContain("active:bg-sidebar-row-active");
      expect(html).toContain("data-[active=true]:bg-sidebar-row-selected");
    }
  });

  it("keeps the resize rail visually neutral on hover", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarRail />
      </SidebarProvider>,
    );

    expect(html).toContain('data-slot="sidebar-rail"');
    expect(html).toContain("cursor-w-resize");
    expect(html).toContain('title="Toggle Sidebar"');
    expect(html).not.toContain("hover:after:bg-sidebar-border");
    expect(html).not.toContain("hover:group-data-[collapsible=offcanvas]:bg-sidebar");
    expect(html).not.toContain('data-slot="tooltip-popup"');
  });
});
