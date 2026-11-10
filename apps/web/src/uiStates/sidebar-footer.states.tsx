import { it, vi } from "vite-plus/test";

import { COMPACT_FOOTER_STATES, FULL_FOOTER_STATES } from "./sidebarFooter.fixture";
import { captureUiStateSheet } from "./uiStateSheet";

/*
 * The sidebar footer: Settings, Bots, Pull requests, Usage and the notifications
 * button, the notices above them, in the full sidebar and the compact column.
 * SidebarChromeFooter.upcomputer.browser.test.tsx checks the utility row in each state.
 */

// Data sources, not UI: the desktop update feed, the server configs that carry background
// notices and providers, the desktop shell, the Pull requests capability and the page on screen.
vi.mock("../state/desktopUpdate", async (importOriginal) => {
  const { footerSource } = await import("./sidebarFooter.source");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useDesktopUpdateState: () => footerSource.update,
  };
});
vi.mock("../state/entities", async (importOriginal) => {
  const { footerSource } = await import("./sidebarFooter.source");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useServerConfigs: () =>
      new Map([["environment-ui-states", { backgroundNotices: footerSource.notices }]]),
  };
});
vi.mock("../state/server", async (importOriginal) => {
  const { footerSource } = await import("./sidebarFooter.source");
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    primaryServerProvidersAtom: Atom.make(() => footerSource.providers),
  };
});
// The desktop app's footer; only the architecture warning reads it, and only for an Intel build.
vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: true,
}));
vi.mock("../state/environments", async (importOriginal) => {
  const { footerSource } = await import("./sidebarFooter.source");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    usePullRequestsSupported: () => footerSource.pullRequestsSupported,
  };
});
vi.mock("../hooks/useShownPathname", async () => {
  const { footerSource } = await import("./sidebarFooter.source");
  return { useShownPathname: () => footerSource.pathname };
});

it("sidebar-footer", async () => {
  await captureUiStateSheet("sidebar-footer", [
    { title: "Full sidebar, 256px", states: FULL_FOOTER_STATES },
    { title: "Icon column", states: COMPACT_FOOTER_STATES },
  ]);
});
