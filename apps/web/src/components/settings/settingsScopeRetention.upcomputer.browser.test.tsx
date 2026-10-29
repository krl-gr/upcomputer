import { render } from "../../../test/render";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import type { SettingsScopeSearch } from "./settingsScope";

interface ScopeState {
  readonly search: SettingsScopeSearch;
  readonly environmentId: string | null;
}

const state = vi.hoisted(() => ({
  pathname: "/settings/diagnostics",
  shownPathname: null as string | null,
  scope: { search: {}, environmentId: null } as ScopeState,
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  createFileRoute: (() => (options: { component: () => ReactNode }) => ({
    options,
    useSearch: () => state.scope.search,
    useNavigate: () => vi.fn(),
  })) as never,
  useLocation: ((options?: { select: (location: unknown) => unknown }) => {
    const location = { pathname: state.pathname, hash: "", state: {} };
    return options ? options.select(location) : location;
  }) as never,
  Outlet: (() => <StatefulContent />) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => {
  const { createContext, useContext } = await import("react");
  const Scope = createContext<ScopeState>(state.scope);
  return {
    ...(await original()),
    SettingsScopeProvider: (({ children }: { children: ReactNode }) => (
      <Scope value={state.scope}>{children}</Scope>
    )) as never,
    useSettingsScope: (() => {
      const { search, environmentId } = useContext(Scope);
      return {
        search,
        scope: { kind: "all" },
        environment: environmentId ? { environmentId } : null,
        connectedEnvironments: environmentId ? [{}] : [],
      };
    }) as never,
  };
});
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: [] })) as never,
}));
vi.mock(import("../AppRouteModal"), async (original) => ({
  ...(await original()),
  AppRouteModal: (({ children }: { children?: ReactNode }) => <div>{children}</div>) as never,
  AppRouteModalClose: (() => null) as never,
}));
vi.mock(import("./SettingsSidebarNav"), async (original) => ({
  ...(await original()),
  SettingsSidebarNav: (() => null) as never,
}));
vi.mock(import("./SettingsBreadcrumb"), async (original) => ({
  ...(await original()),
  SettingsBreadcrumb: (() => null) as never,
}));
vi.mock(import("../../hooks/useShownPathname"), async (original) => ({
  ...(await original()),
  useShownPathname: () => state.shownPathname ?? state.pathname,
}));
vi.mock(import("./SettingsPanels"), async (original) => ({
  ...(await original()),
  useSettingsRestore: (() => ({ changedSettingLabels: [] })) as never,
}));

import { Route } from "../../routes/_chat.settings";

function StatefulContent() {
  const [value, setValue] = useState(0);
  return (
    <button aria-label="Retained value" onClick={() => setValue(value + 1)}>
      {value}
    </button>
  );
}

const Layout = Route.options.component!;
await Layout.preload?.();

function setup(pathname: string, scope: ScopeState) {
  state.pathname = pathname;
  state.scope = scope;
}

const first = { search: { machine: "first", project: "one" }, environmentId: "first" };

it("keeps the previous page out from under the header of a page still loading", async () => {
  // A new scope value each time, so the layout renders again with the new paths.
  setup("/settings/general", { ...first });
  state.shownPathname = null;
  await using screen = await render(<Layout />);
  const { container } = screen;
  const retainedValue = () =>
    container.querySelector('button[aria-label="Retained value"]')?.textContent ?? null;
  expect(retainedValue()).toBe("0");

  state.pathname = "/settings/providers";
  state.shownPathname = "/settings/general";
  state.scope = { ...first };
  await screen.rerender(<Layout />);
  expect(retainedValue()).toBeNull();

  state.shownPathname = null;
  state.scope = { ...first };
  await screen.rerender(<Layout />);
  expect(retainedValue()).toBe("0");
});
