import { it, vi } from "vite-plus/test";

import { type FooterOptions, footer } from "./sidebarFooter.fixture";
import { captureUiStateSheet } from "./uiStateSheet";

/*
 * The thread undo notice in the compact icon column, through its real lifecycle
 * (archive shows it, mod+z fades it out, then it is gone), and while the sidebar
 * switches width. `vp run ui-states collapsed-undo`.
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

function lifecycle(prefix: string, options: FooterOptions) {
  return [
    footer(`${prefix}: thread archived, the notice shows`, { ...options, undo: "showing" }),
    footer(`${prefix}: two threads archived`, { ...options, undo: "showing-two" }),
    footer(`${prefix}: fading out, 45ms into the 180ms fade (after mod+z, or 5s)`, {
      ...options,
      undo: "fading-half",
    }),
    footer(`${prefix}: gone`, { ...options, undo: "ended" }),
  ];
}

it("collapsed-undo", async () => {
  const column: FooterOptions = { compact: true, page: true };
  await captureUiStateSheet(
    "collapsed-undo",
    [
      {
        title: "Icon column: the undo tile",
        states: [
          ...lifecycle("icon column", column),
          footer("sidebar dragged open while the notice is live: the pill takes over", {
            ...column,
            undo: "showing-expanded",
          }),
          footer("sidebar collapsed while the pill is live: the tile takes over", {
            page: true,
            undo: "showing-collapsed",
          }),
        ],
      },
      { title: "Full sidebar, 256px: the pill", states: lifecycle("full sidebar", {}) },
    ],
    { cellWidth: 360 },
  );
});
