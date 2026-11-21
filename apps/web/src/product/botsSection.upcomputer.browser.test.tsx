import "~/index.css";
import "../adaptiveSidebar/adaptiveSidebar.css";

import { EnvironmentId } from "@t3tools/contracts";
import { BOTS_ORDER_STORAGE_KEY, BotsSection } from "@t3tools/tasks-web/bots";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { SIDEBAR_COMPACT_WIDTH } from "../adaptiveSidebar/sidebarWidthMode";
import { useCloseMobileSidebarOnNavigate } from "../components/sidebar/closeMobileSidebarOnNavigate.upcomputer";
import { Sidebar as SidebarSheet, SidebarProvider, useSidebar } from "../components/ui/sidebar";
import { ProductSidebarNavigation } from "./ProductSlots";
import { bot } from "../uiStates/sidebarRowFixtures";
import { render } from "../../test/render";

// The Tasks server the rows ask for run counts and the access that lets them.
vi.mock("../../../../packages/tasks-web/src/environmentApi.ts", async (importOriginal) => {
  const { resolveTasksWebAccess } = await import("@t3tools/tasks-web/rpc");
  const client = {
    tasks: {
      subscribe: () => () => undefined,
      threadRunCounts: async () => ({ threads: [] }),
      markThreadsSeen: async () => undefined,
    },
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    readTasksWebAccess: () => resolveTasksWebAccess({ availability: "enabled" }),
    readTasksWebClient: () => client,
    useTasksWebAccessRevision: () => 0,
  };
});

const BOTS = [
  bot("bot-scout", "Scout"),
  bot("bot-builder", "Builder"),
  bot("bot-writer", "Writer"),
];

function Sidebar(props: { readonly environmentId: EnvironmentId; readonly compact: boolean }) {
  return (
    <SidebarProvider data-sidebar-compact={props.compact ? "true" : "false"}>
      <div
        data-app-sidebar=""
        className="w-64"
        style={props.compact ? { width: SIDEBAR_COMPACT_WIDTH } : undefined}
      >
        <div data-sidebar="sidebar" className="bg-sidebar">
          <BotsSection lists={[{ environmentId: props.environmentId, bots: BOTS, loaded: true }]} />
        </div>
      </div>
    </SidebarProvider>
  );
}

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-sidebar-list-row]")];
const rowOf = (name: string) => rows().find((row) => row.textContent?.includes(name))!;
const names = () => rows().map((row) => row.textContent);

describe("Bots section order", () => {
  it.each([
    { compact: false, where: "the full sidebar" },
    { compact: true, where: "the icon column" },
  ])(
    "opens a bot on a click, and drags a bot to a new place in $where that it keeps",
    async ({ compact }) => {
      const environmentId = EnvironmentId.make(`environment-${compact ? "compact" : "full"}`);
      localStorage.removeItem(BOTS_ORDER_STORAGE_KEY);
      using _order = { [Symbol.dispose]: () => localStorage.removeItem(BOTS_ORDER_STORAGE_KEY) };
      const sidebar = () => <Sidebar environmentId={environmentId} compact={compact} />;
      await using screen = await render(sidebar());
      expect(names()).toEqual(["Scout", "Builder", "Writer"]);
      // Before any drag: dnd-kit swallows clicks for 50 ms after a drop, on the whole document.
      await userEvent.click(rowOf("Builder"));
      const builderChat = `/${environmentId}/bot-builder-chat`;
      await expect.poll(() => screen.router!.state.location.pathname).toBe(builderChat);

      // A real mouse: the button goes up over the dropped row, whose click must not open it.
      await userEvent.dragAndDrop(rowOf("Scout"), rowOf("Writer"), { steps: 8 });
      await expect.poll(names).toEqual(["Builder", "Writer", "Scout"]);
      // The history moves as soon as a navigation starts; the router's state follows later.
      expect(screen.router!.history.location.pathname).toBe(builderChat);

      // A reload reads the order back.
      await screen.unmount();
      await using _again = await render(sidebar());
      expect(names()).toEqual(["Builder", "Writer", "Scout"]);
    },
  );
});

function PhoneSidebar(props: { readonly environmentId: EnvironmentId }) {
  return (
    <SidebarProvider>
      <PhoneShell />
      <SidebarSheet>
        <ProductSidebarNavigation />
        <BotsSection lists={[{ environmentId: props.environmentId, bots: BOTS, loaded: true }]} />
      </SidebarSheet>
    </SidebarProvider>
  );
}

/** The app shell's part: the close-on-navigate rule and the button that opens the sheet. */
function PhoneShell() {
  useCloseMobileSidebarOnNavigate();
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <button type="button" data-sheet-open={openMobile} onClick={() => setOpenMobile(true)}>
      Open sidebar
    </button>
  );
}

describe("Phone sidebar", () => {
  it("closes when an entry navigates, also to the page already open, and stays open for a menu", async () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(390, 800);
    await using _viewport = {
      [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
    };
    const environmentId = EnvironmentId.make("environment-phone");
    localStorage.removeItem(BOTS_ORDER_STORAGE_KEY);
    using _order = { [Symbol.dispose]: () => localStorage.removeItem(BOTS_ORDER_STORAGE_KEY) };
    await using screen = await render(<PhoneSidebar environmentId={environmentId} />);
    // The open sheet is modal, which hides the rest of the page from role queries.
    const sheetOpen = () =>
      document.querySelector("[data-sheet-open]")?.getAttribute("data-sheet-open");
    const openSheet = async () => {
      await userEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
      await expect.poll(sheetOpen).toBe("true");
      await expect.element(screen.getByText("Builder")).toBeVisible();
    };
    const builderChat = `/${environmentId}/bot-builder-chat`;

    await openSheet();
    await userEvent.click(rowOf("Builder"));
    await expect.poll(() => screen.router!.state.location.pathname).toBe(builderChat);
    await expect.poll(sheetOpen).toBe("false");

    await openSheet();
    await userEvent.click(rowOf("Builder"));
    await expect.poll(sheetOpen).toBe("false");
    expect(screen.router!.state.location.pathname).toBe(builderChat);

    await openSheet();
    await userEvent.click(rowOf("Builder"), { button: "right" });
    await expect.element(screen.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    expect(sheetOpen()).toBe("true");
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Settings" }))
      .not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Tasks" }));
    await expect.poll(() => screen.router!.state.location.pathname).toBe("/tasks");
    await expect.poll(sheetOpen).toBe("false");
  });
});
