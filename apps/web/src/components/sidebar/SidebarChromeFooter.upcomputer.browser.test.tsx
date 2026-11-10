import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import {
  COMPACT_FOOTER_STATES,
  FULL_FOOTER_STATES,
  type FooterState,
} from "../../uiStates/sidebarFooter.fixture";

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

/** The notices a state shows above the row, each as its label and its action, if any. */
function expectedNotices(options: FooterState["options"]) {
  const notices: Array<readonly [label: string, action: string | null]> = [];
  if (options.providers?.length) notices.push(["Updating Claude", null]);
  if (options.update?.appArch === "x64") {
    const status = options.update.status;
    const action = status === "available" ? "Download" : status === "downloaded" ? "Restart" : null;
    notices.push(["Intel build on Apple Silicon", action]);
  }
  if (options.undo === "showing") notices.push(["Archived", "Undo"]);
  if (options.undo === "showing-two") notices.push(["Archived 2", "Undo"]);
  return notices;
}

const STATES = [...FULL_FOOTER_STATES, ...COMPACT_FOOTER_STATES];

it.each(STATES.map((state) => [state.name, state] as const))(
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

      // A notice that ended is inert while it fades out; only a fading state may have one.
      const notices = [...footer.children].filter((child) => child !== row);
      const leaving = notices.filter((notice) => notice.hasAttribute("inert"));
      expect(leaving.length).toBeLessThanOrEqual(state.options.undo === "fading" ? 1 : 0);
      const shown = notices.filter((notice) => !leaving.includes(notice));
      expect(
        shown.map((notice) => [
          notice.textContent,
          // The provider pill's label is a button of its own.
          notice.querySelector("button:not([data-provider-update-main])")?.textContent ?? null,
        ]),
      ).toEqual(
        expectedNotices(state.options).map(([label, action]) => [
          expect.stringContaining(label),
          action === null ? null : expect.stringContaining(action),
        ]),
      );
    } finally {
      if (undo) await act(undo);
    }
  },
);
