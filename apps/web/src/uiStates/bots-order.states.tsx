import "../adaptiveSidebar/adaptiveSidebar.css";

import { BOTS_ORDER_STORAGE_KEY, BotsSection, botOrderKey } from "@t3tools/tasks-web/bots";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { SIDEBAR_COMPACT_WIDTH } from "../adaptiveSidebar/sidebarWidthMode";
import { SidebarProvider } from "../components/ui/sidebar";
import { act } from "../../test/render";
import { ENVIRONMENT_ID, bot } from "./sidebarRowFixtures";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/* The sidebar's Bots section, full and as the icon column, before, during and after a drag. */

// Data sources, not UI: bot chat shells and the Tasks server's run counts, as in sidebar-scroll.
vi.mock("../state/entities", async (importOriginal) => {
  const fixtures = await import("./sidebarRowFixtures");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useThreadShell: (ref: { readonly threadId: string } | null) => {
      const wire = ref ? fixtures.BOT_CHAT_WIRE[ref.threadId] : undefined;
      return ref && wire ? fixtures.threadShell(ref.threadId, "Chat", wire) : null;
    },
  };
});
vi.mock("../../../../packages/tasks-web/src/environmentApi.ts", async (importOriginal) => {
  const fixtures = await import("./sidebarRowFixtures");
  const { resolveTasksWebAccess } = await import("@t3tools/tasks-web/rpc");
  const client = {
    tasks: {
      subscribe: () => () => undefined,
      threadRunCounts: async (input: { readonly threadIds: ReadonlyArray<string> }) => ({
        threads: input.threadIds.flatMap((threadId) => {
          const runCounts = fixtures.RUN_COUNTS[threadId];
          return runCounts ? [{ threadId, runCounts }] : [];
        }),
      }),
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

const SCOUT = bot("bot-idle", "Scout");
const BUILDER = bot("bot-working", "Builder");
const REVIEWER = bot("bot-attention", "Reviewer");
const PLANNER = bot("bot-runs", "Planner");
const WRITER = bot("bot-writer", "Writer");
const NEWBIE = bot("bot-newbie", "Newbie");
const BOTS = [SCOUT, BUILDER, REVIEWER, PLANNER, WRITER];

function Bots(props: { readonly compact?: boolean; readonly bots?: typeof BOTS }) {
  return (
    <SidebarProvider className="min-h-0" data-sidebar-compact={props.compact ? "true" : "false"}>
      <div
        data-app-sidebar=""
        className="-mx-(--sidebar-content-inset) w-64"
        style={props.compact ? { width: SIDEBAR_COMPACT_WIDTH } : undefined}
      >
        <div data-sidebar="sidebar" className="bg-sidebar pb-2">
          <BotsSection
            lists={[
              { environmentId: ENVIRONMENT_ID, bots: props.bots ?? BOTS, loaded: true, error: "" },
            ]}
          />
        </div>
      </div>
    </SidebarProvider>
  );
}

/** Starts each state from the saved order given, and leaves none for the next. */
const savedOrder =
  (bots: ReadonlyArray<typeof SCOUT> = []) =>
  () => {
    localStorage.setItem(
      BOTS_ORDER_STORAGE_KEY,
      JSON.stringify(bots.map((shown) => botOrderKey(ENVIRONMENT_ID, shown))),
    );
    return () => localStorage.removeItem(BOTS_ORDER_STORAGE_KEY);
  };

const rowOf = (cell: HTMLElement, name: string) =>
  [...cell.querySelectorAll<HTMLElement>("[data-sidebar-list-row]")].find((row) =>
    row.textContent?.includes(name),
  )!;
/** Each row's bot name, without the run counts that follow it. */
const names = (cell: HTMLElement) =>
  [...cell.querySelectorAll<HTMLElement>("[data-sidebar-list-row]")].map(
    (row) =>
      [...BOTS, NEWBIE].find((shown) => row.textContent?.startsWith(shown.agent.name))?.agent.name,
  );

const center = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

function pointer(type: string, point: { x: number; y: number }, on: EventTarget) {
  on.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    }),
  );
}

/**
 * Holds Scout over Planner: the sheet keeps a copy of that moment, then the drag is
 * cancelled so the next state starts without one.
 */
async function holdScoutOverPlanner(cell: HTMLElement) {
  const from = center(rowOf(cell, "Scout"));
  const to = center(rowOf(cell, "Planner"));
  await act(() => pointer("pointerdown", from, rowOf(cell, "Scout")));
  for (let step = 1; step <= 8; step++) {
    const point = { x: from.x, y: from.y + ((to.y - from.y) * step) / 8 };
    await act(() => pointer("pointermove", point, document));
  }
  await vi.waitFor(() =>
    expect(cell.querySelector("[data-sidebar-list-row].shadow-lg")).not.toBeNull(),
  );
  // A copy starts at its inline transforms, so it shows the rows at rest, not mid-slide.
  const frozen = cell.cloneNode(true) as HTMLElement;
  await act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" })));
  // First in the document, so the copy's gradient ids win over the hidden original's.
  cell.before(frozen);
  cell.style.display = "none";
}

/** A real mouse drag of Scout onto Writer's place. */
async function dropScoutOnWriter(cell: HTMLElement) {
  await userEvent.dragAndDrop(rowOf(cell, "Scout"), rowOf(cell, "Writer"), { steps: 8 });
  await vi.waitFor(() =>
    expect(names(cell)).toEqual(["Builder", "Reviewer", "Planner", "Writer", "Scout"]),
  );
}

const states = (compact: boolean): ReadonlyArray<UiState> => [
  {
    name: "nothing moved yet: the order the computer lists",
    setup: savedOrder(),
    render: () => <Bots compact={compact} />,
  },
  {
    name: "dragging Scout over Planner: Scout lifted under the pointer, the others make room",
    setup: savedOrder(),
    render: () => <Bots compact={compact} />,
    settle: holdScoutOverPlanner,
  },
  {
    name: "Scout dropped on Writer: it stays at the end",
    setup: savedOrder(),
    render: () => <Bots compact={compact} />,
    settle: dropScoutOnWriter,
  },
  {
    name: "after a move, Newbie created and Reviewer deleted: Newbie goes to the end",
    setup: savedOrder([BUILDER, REVIEWER, PLANNER, WRITER, SCOUT]),
    render: () => <Bots compact={compact} bots={[SCOUT, BUILDER, PLANNER, WRITER, NEWBIE]} />,
  },
];

it("bots-order", async () => {
  await captureUiStateSheet("bots-order", [
    { title: "Full sidebar", states: states(false) },
    { title: "Icon column", states: states(true) },
  ]);
});
