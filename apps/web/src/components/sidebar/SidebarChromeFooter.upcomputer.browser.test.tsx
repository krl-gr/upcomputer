import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { FULL_FOOTER_STATES, type FooterState } from "../../uiStates/sidebarFooter.fixture";

// The same data sources sidebar-footer.states.tsx mocks, so both draw the same states.
vi.mock("../../state/desktopUpdate", async (importOriginal) => {
  const { footerSource } = await import("../../uiStates/sidebarFooter.source");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useDesktopUpdateState: () => footerSource.update,
  };
});
vi.mock("../../state/entities", async (importOriginal) => {
  const { footerSource } = await import("../../uiStates/sidebarFooter.source");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useServerConfigs: () =>
      new Map([["environment-ui-states", { backgroundNotices: footerSource.notices }]]),
  };
});
vi.mock("../../state/server", async (importOriginal) => {
  const { footerSource } = await import("../../uiStates/sidebarFooter.source");
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    primaryServerProvidersAtom: Atom.make(() => footerSource.providers),
  };
});
vi.mock("../../env", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: true,
}));
vi.mock("../../state/environments", async (importOriginal) => {
  const { footerSource } = await import("../../uiStates/sidebarFooter.source");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    usePullRequestsSupported: () => footerSource.pullRequestsSupported,
  };
});
vi.mock("../../hooks/useShownPathname", async () => {
  const { footerSource } = await import("../../uiStates/sidebarFooter.source");
  return { useShownPathname: () => footerSource.pathname };
});

function expectedNotices(options: FooterState["options"]) {
  return [
    ...(options.providers?.length ? ["Updating Claude"] : []),
    ...(options.update?.appArch === "x64" ? ["Intel build on Apple Silicon"] : []),
    // A fading notice is still on screen until its exit timer ends.
    ...(options.undo === "showing" || options.undo === "fading" ? ["Archived"] : []),
    ...(options.undo === "showing-two" ? ["Archived 2"] : []),
  ];
}

it.each(FULL_FOOTER_STATES.map((state) => [state.name, state] as const))(
  "footer, %s: the utility row holds only buttons, notices sit above it",
  async (_name, state) => {
    const undo = state.setup?.();
    try {
      await using screen = await render(state.render());
      await state.settle?.(screen.container);
      const footer = screen.container.querySelector('[data-sidebar="footer"]')!;
      const row = footer.querySelector(':scope > [data-sidebar="menu"]')!;

      // The Back button is the row's one labelled button; everything else is an icon.
      const buttons = [...row.querySelectorAll('[data-sidebar="menu-button"]')];
      expect(row.querySelectorAll(':scope > [data-sidebar="menu-item"]')).toHaveLength(
        buttons.length,
      );
      const labelled = buttons.filter((button) => button.getAttribute("data-size") !== "icon");
      expect(labelled.map((button) => button.textContent)).toEqual(
        state.options.pathname ? ["Back"] : [],
      );
      const rowText = buttons.reduce(
        (text, button) => text.replace(button.textContent ?? "", ""),
        row.textContent ?? "",
      );
      expect(rowText.trim()).toBe("");
      expect(row.querySelector("[inert]")).toBeNull();

      const notices = [...footer.children].filter((child) => child !== row);
      expect(notices.map((notice) => notice.textContent?.trim())).toEqual(
        expectedNotices(state.options).map((label) => expect.stringContaining(label)),
      );
    } finally {
      if (undo) await act(undo);
    }
  },
);
