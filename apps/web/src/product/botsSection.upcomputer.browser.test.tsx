import "~/index.css";
import "../adaptiveSidebar/adaptiveSidebar.css";

import { EnvironmentId } from "@t3tools/contracts";
import { BOTS_ORDER_STORAGE_KEY, BotsSection } from "@t3tools/tasks-web/bots";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { SIDEBAR_COMPACT_WIDTH } from "../adaptiveSidebar/sidebarWidthMode";
import { SidebarProvider } from "../components/ui/sidebar";
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
          <BotsSection lists={[{ environmentId: props.environmentId, bots: BOTS, error: "" }]} />
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
    "drags a bot to a new place in $where, keeps it, and still opens on a click",
    async ({ compact }) => {
      const environmentId = EnvironmentId.make(`environment-${compact ? "compact" : "full"}`);
      localStorage.removeItem(BOTS_ORDER_STORAGE_KEY);
      const sidebar = () => <Sidebar environmentId={environmentId} compact={compact} />;
      await using screen = await render(sidebar());
      expect(names()).toEqual(["Scout", "Builder", "Writer"]);

      // A real mouse: the button goes up over the dropped row, whose click must not open it.
      await userEvent.dragAndDrop(rowOf("Scout"), rowOf("Writer"), { steps: 8 });
      await expect.poll(names).toEqual(["Builder", "Writer", "Scout"]);
      expect(screen.router!.state.location.pathname).toBe("/");

      // A reload reads the order back.
      await screen.unmount();
      await using again = await render(sidebar());
      expect(names()).toEqual(["Builder", "Writer", "Scout"]);

      await userEvent.click(rowOf("Scout"));
      await expect
        .poll(() => again.router!.state.location.pathname)
        .toBe(`/${environmentId}/bot-scout-chat`);
    },
  );
});
