import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  sidebarViewMode: "nested",
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: mocks.pathname }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { sidebarViewMode: string }) => unknown) =>
    select({ sidebarViewMode: mocks.sidebarViewMode }),
  useUpdateClientSettings: () => vi.fn(),
}));

vi.mock("./sidebar/sidebarViewMode", () => ({
  resolveAvailableSidebarViewMode: (viewMode: string) => viewMode,
}));

vi.mock("./Sidebar", () => ({ default: () => <div data-testid="sidebar-v1" /> }));
vi.mock("./SidebarV2", () => ({ default: () => <div data-testid="sidebar-v2" /> }));
vi.mock("./ui/sidebar", () => ({
  Sidebar: ({
    children,
    resizable: _resizable,
    ...props
  }: {
    children: ReactNode;
    resizable: unknown;
  }) => <aside {...props}>{children}</aside>,
  SidebarProvider: ({ children, ...props }: { children: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  SidebarRail: () => null,
}));

import { AppSidebarLayout } from "./AppSidebarLayout";

function renderLayout() {
  return renderToStaticMarkup(
    <AppSidebarLayout>
      <main />
    </AppSidebarLayout>,
  );
}

describe("AppSidebarLayout theme scope", () => {
  beforeEach(() => {
    mocks.pathname = "/";
    mocks.sidebarViewMode = "nested";
    vi.stubGlobal("window", { innerWidth: 1200 });
  });

  it("scopes the classic and focused views to the v1 implementation", () => {
    for (const mode of ["nested", "focused"]) {
      mocks.sidebarViewMode = mode;
      const html = renderLayout();

      expect(html).toContain('data-upcomputer-sidebar-version="v1"');
      expect(html).toContain('data-testid="sidebar-v1"');
    }
  });

  it("scopes the flat view to v2, except on settings routes that render v1", () => {
    mocks.sidebarViewMode = "v2";
    expect(renderLayout()).toContain('data-upcomputer-sidebar-version="v2"');

    mocks.pathname = "/settings/agents";
    const settingsHtml = renderLayout();
    expect(settingsHtml).toContain('data-upcomputer-sidebar-version="v1"');
    expect(settingsHtml).toContain('data-testid="sidebar-v1"');
  });
});
