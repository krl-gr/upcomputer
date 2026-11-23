import { EnvironmentId } from "@t3tools/contracts";
import type {
  Bot,
  InstructionUpdates,
  InstructionUpdateStatus,
  InstructionUpdatesUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import { InstructionUpdatesSection } from "@t3tools/tasks-web/workflowUpdates";
import type { ReactNode } from "react";
import { it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { SidebarMenu, SidebarProvider } from "../components/ui/sidebar";
import { ToastProvider, toastManager } from "../components/ui/toast";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { SidebarNotifications } from "../sidebarNotifications/SidebarNotifications";
import { bot } from "./sidebarRowFixtures";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * Instruction updates: the bell's card and the Settings → Instructions group.
 * Each environment below is one install, with its updates and bots in the
 * server's shapes. Popups portal to the body, so a state copies the open one
 * into its cell.
 */

const source = vi.hoisted(() => ({
  primary: null as EnvironmentId | null,
  servers: new Map<
    EnvironmentId,
    { readonly updates: InstructionUpdates; readonly bots: ReadonlyArray<Bot> }
  >(),
}));

// Data sources, not UI: the Tasks server's instruction updates and bots, the
// primary environment, its projects, and an empty notifications feed.
vi.mock("../../../../packages/tasks-web/src/environmentApi.ts", async (importOriginal) => {
  const { resolveTasksWebAccess } = await import("@t3tools/tasks-web/rpc");
  const access = resolveTasksWebAccess({ availability: "enabled" });
  const sync = {
    kind: "sync",
    sequence: 0,
    taskIds: [],
    rootThreadIds: [],
    listChanged: true,
    runsChanged: true,
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    readTasksWebAccess: () => access,
    useTasksWebAccess: () => access,
    readTasksWebClient: (environmentId: EnvironmentId) => ({
      tasks: {
        subscribe: (listener: (change: typeof sync) => void) => {
          queueMicrotask(() => listener(sync));
          return () => undefined;
        },
        getInstructionUpdates: async () => source.servers.get(environmentId)?.updates,
        // Answers without saving, so the next render starts from the same state.
        updateInstructionUpdates: async (input: InstructionUpdatesUpdateInput) => {
          const { updates } = source.servers.get(environmentId)!;
          return {
            mode: input.mode ?? updates.mode,
            entries: updates.entries.map((status) => {
              const change = input.entries?.find((entry) => entry.id === status.id);
              return change ? { ...status, state: change.state } : status;
            }),
          };
        },
      },
      bots: { list: async () => source.servers.get(environmentId)?.bots ?? [] },
    }),
  };
});
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePrimaryEnvironmentId: () => source.primary,
  useEnvironments: () => ({ environments: [] }),
  useEnvironmentProviders: () => new Map(),
}));
vi.mock("../state/entities", async (importOriginal) => {
  const { PROJECT } = await import("./sidebarRowFixtures");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useServerConfigs: () => new Map(),
    // Each install has a project, so "Discuss in a chat" can open one.
    useProjects: () =>
      [...source.servers.keys()].map((environmentId) => ({
        ...PROJECT,
        environmentId,
      })),
  };
});
vi.mock("../state/desktopUpdate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDesktopUpdateState: () => null,
}));
vi.mock("../userSurvey/useUserSurvey", () => ({ useUserSurvey: () => null }));

const TODAY = new Date().toISOString();
const PENNY = bot("bot-penny", "Penny");
const BOTS = [PENNY, bot("bot-scout", "Scout"), bot("bot-builder", "Builder")];

const status = (overrides: Partial<InstructionUpdateStatus> = {}): InstructionUpdateStatus => ({
  id: "task-statuses-v2",
  state: "pending",
  decidedAt: null,
  decidedBy: null,
  touchesEditedText: false,
  ...overrides,
});

function install(
  name: string,
  updates: InstructionUpdates,
  bots: ReadonlyArray<Bot> = [PENNY],
): EnvironmentId {
  const environmentId = EnvironmentId.make(`environment-${name}`);
  source.servers.set(environmentId, { updates, bots });
  return environmentId;
}

// An install created with the update has it applied with no decision, and lists nothing.
const NOTHING = install("nothing", {
  mode: "ask",
  entries: [status({ state: "applied" })],
});
const NO_BOTS = install("no-bots", { mode: "ask", entries: [status()] }, []);
const ONE_BOT = install("one-bot", { mode: "ask", entries: [status()] });
const SEVERAL_BOTS = install("several-bots", { mode: "ask", entries: [status()] }, BOTS);
const DISMISSING = install("dismissing", { mode: "ask", entries: [status()] });
const APPLIED_WITH_PENNY = install("applied-with-penny", {
  mode: "ask",
  entries: [
    status({ state: "applied", decidedAt: TODAY, decidedBy: { kind: "chat", name: "Penny" } }),
  ],
});
const APPLIED_AUTOMATICALLY = install("applied-automatically", {
  mode: "auto",
  entries: [
    status({ state: "applied", decidedAt: TODAY, decidedBy: { kind: "auto", name: null } }),
  ],
});
const KEPT = install("kept", {
  mode: "ask",
  entries: [status({ state: "kept", decidedAt: TODAY, decidedBy: { kind: "person", name: null } })],
});
const WAITING = install("waiting", {
  mode: "auto",
  entries: [status({ touchesEditedText: true })],
});
const PHONE = install("phone", { mode: "ask", entries: [status()] }, BOTS);

/** Waits for a popup's opening transition, then copies it into `target`. */
async function copyPopup(popup: HTMLElement, target: Element) {
  await Promise.all(
    popup
      .getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)),
  );
  const copy = popup.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-starting-style");
  copy.removeAttribute("id");
  for (const property of ["position", "top", "bottom", "left", "right", "transform"]) {
    copy.style.removeProperty(property);
  }
  target.append(copy);
}

function openPopup(selector: string): HTMLElement {
  // The last one: earlier cells hold copies, and portals come after the sheet.
  const popup = [...document.querySelectorAll<HTMLElement>(`${selector}[data-open]`)].at(-1);
  if (!popup) throw new Error(`${selector} is not open`);
  return popup;
}

function Bell() {
  return (
    <AppAtomRegistryProvider>
      <ToastProvider>
        <SidebarProvider className="min-h-0" data-sidebar-compact="false">
          <div data-app-sidebar="" className="flex flex-col py-2">
            <div data-popup-copy="" className="mb-1 flex flex-col gap-2 empty:hidden" />
            <SidebarMenu className="flex-row items-center">
              <SidebarNotifications />
            </SidebarMenu>
          </div>
        </SidebarProvider>
      </ToastProvider>
    </AppAtomRegistryProvider>
  );
}

/** The card's own popup, once its install's updates and bots arrived. */
async function openBell(cell: HTMLElement, card: boolean): Promise<HTMLElement> {
  const trigger = cell.querySelector<HTMLElement>('[data-track="sidebar.notifications"]')!;
  await userEvent.click(trigger);
  const popup = await vi.waitFor(() => {
    const id = trigger.getAttribute("aria-controls");
    const open = id ? document.getElementById(id) : null;
    if (!open?.hasAttribute("data-open")) throw new Error("The notifications popover is not open");
    // The bots load after the updates; the button's label waits for them.
    const discuss = open.querySelector('[data-track="instruction-updates.discuss"]');
    if (card && !discuss?.textContent?.trim()) throw new Error("No card yet");
    return open;
  });
  await userEvent.unhover(trigger);
  return popup;
}

function bell(
  name: string,
  environmentId: EnvironmentId,
  options: {
    readonly card?: boolean;
    readonly settle?: (popup: HTMLElement, cell: HTMLElement) => Promise<void>;
  } = {},
): UiState {
  return {
    name,
    render: () => <Bell />,
    setup: () => {
      source.primary = environmentId;
      return () => {
        source.primary = null;
      };
    },
    settle: async (cell) => {
      const popup = await openBell(cell, options.card ?? true);
      if (options.settle) await options.settle(popup, cell);
      else await copyPopup(popup, cell.querySelector("[data-popup-copy]")!);
    },
  };
}

const BELL_STATES: ReadonlyArray<UiState> = [
  bell("nothing pending: no card", NOTHING, { card: false }),
  bell("one update, no bots: Discuss in a chat", NO_BOTS),
  bell("one update, one bot: Discuss with Penny", ONE_BOT),
  bell("one update, several bots: the menu open", SEVERAL_BOTS, {
    settle: async (popup, cell) => {
      await userEvent.click(
        popup.querySelector<HTMLElement>('[data-track="instruction-updates.discuss"]')!,
      );
      const menu = await vi.waitFor(() => openPopup('[data-slot="menu-popup"]'));
      // The popover first, then the menu under it.
      await copyPopup(popup, cell.querySelector("[data-popup-copy]")!);
      await copyPopup(menu, cell.querySelector("[data-popup-copy]")!);
      await userEvent.keyboard("{Escape}");
    },
  }),
  bell("after dismiss: the card is gone, the toast says where it went", DISMISSING, {
    settle: async (popup, cell) => {
      const card = popup
        .querySelector('[data-track="instruction-updates.discuss"]')!
        .closest("li")!;
      await userEvent.click(card.querySelector<HTMLElement>(":scope > span:last-child button")!);
      await vi.waitFor(() => {
        if (popup.querySelector('[data-track="instruction-updates.discuss"]'))
          throw new Error("The card is still there");
      });
      const toast = await vi.waitFor(() => {
        const found = document.querySelector<HTMLElement>(
          '[data-slot="toast-viewport"] [data-slot="toast-title"]',
        );
        if (!found) throw new Error("No toast");
        return found.closest<HTMLElement>("[data-slot=toast-viewport] > *")!;
      });
      await copyPopup(popup, cell.querySelector("[data-popup-copy]")!);
      const toastCopy = toast.cloneNode(true) as HTMLElement;
      toastCopy.removeAttribute("style");
      toastCopy.className = `${toastCopy.className} relative! inset-auto! translate-0! w-full!`;
      cell.querySelector("[data-popup-copy]")!.append(toastCopy);
      toastManager.close();
      await vi.waitFor(() => {
        if (document.querySelector('[data-slot="toast-viewport"] [data-slot="toast-title"]'))
          throw new Error("The toast is still open");
      });
    },
  }),
];

/** Settings → Instructions, as the page draws the group: on the page's background. */
function Settings({
  environmentId,
  height,
}: {
  readonly environmentId: EnvironmentId;
  /** Clips a tall expanded row to a window of the page. */
  readonly height?: number;
}): ReactNode {
  return (
    <div
      data-settings-window=""
      className="overflow-hidden bg-background p-4 text-foreground"
      style={height === undefined ? undefined : { height }}
    >
      <InstructionUpdatesSection environmentId={environmentId} />
    </div>
  );
}

async function settled(cell: HTMLElement) {
  await vi.waitFor(() => {
    if (!cell.querySelector("[data-slot=settings-row]")) throw new Error("No group yet");
  });
}

async function expand(cell: HTMLElement) {
  await vi.waitFor(() => {
    if (!cell.querySelector('[data-track="instruction-updates.discuss"]')?.textContent?.trim())
      throw new Error("The row has not loaded");
  });
  await userEvent.click(cell.querySelector<HTMLElement>("[data-slot=collapsible-trigger]")!);
  await vi.waitFor(() => {
    if (!cell.querySelector("[data-changed]")) throw new Error("The row did not expand");
  });
  // The panel grows from no height; until it ends, nothing below it can be scrolled to.
  await Promise.all(
    cell.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => null)),
  );
}

/** Scrolls the clipped window to the second-to-last change: the task execution text. */
async function scrollToExecutionText(cell: HTMLElement) {
  await expand(cell);
  const window = cell.querySelector<HTMLElement>("[data-settings-window]")!;
  const headings = [...cell.querySelectorAll<HTMLElement>("h4")];
  const heading = headings.at(-2)!;
  window.scrollTop = heading.getBoundingClientRect().top - window.getBoundingClientRect().top - 16;
}

const settings = (
  name: string,
  environmentId: EnvironmentId,
  settle: (cell: HTMLElement) => Promise<void> = settled,
  height?: number,
): UiState => ({
  name,
  render: () => <Settings environmentId={environmentId} {...(height ? { height } : {})} />,
  settle: async (cell) => {
    await settled(cell);
    await settle(cell);
  },
});

const waitForRowState = (state: string) => async (cell: HTMLElement) => {
  await vi.waitFor(() => {
    if (!cell.querySelector(`[data-instruction-update="${state}"]`))
      throw new Error(`No ${state} row`);
  });
};

const SETTINGS_STATES: ReadonlyArray<UiState> = [
  settings("nothing pending: only the setting", NOTHING),
  settings("one pending, collapsed: Keep mine, Discuss with Penny", ONE_BOT, async (cell) => {
    await vi.waitFor(() => {
      if (!cell.querySelector('[data-track="instruction-updates.discuss"]')?.textContent?.trim())
        throw new Error("The row has not loaded");
    });
  }),
  settings("applied today with Penny", APPLIED_WITH_PENNY, waitForRowState("applied")),
  settings("applied automatically", APPLIED_AUTOMATICALLY, waitForRowState("applied")),
  settings("kept: Kept yours, Reopen", KEPT, waitForRowState("kept")),
  settings("mode select open", ONE_BOT, async (cell) => {
    await waitForRowState("pending")(cell);
    await userEvent.click(cell.querySelector<HTMLElement>("[data-slot=select-trigger]")!);
    const popup = await vi.waitFor(() => openPopup('[data-slot="select-popup"]'));
    const holder = document.createElement("div");
    holder.className = "flex justify-end px-4 pb-2";
    cell.append(holder);
    await copyPopup(popup, holder);
    await userEvent.keyboard("{Escape}");
  }),
  settings(
    "Apply automatically: an update that changes edited text waits",
    WAITING,
    waitForRowState("pending"),
  ),
];

const EXPANDED_STATES: ReadonlyArray<UiState> = [
  settings("one pending, expanded: statuses and group order", ONE_BOT, expand, 1080),
  settings(
    "expanded, scrolled to an instruction text: changed words marked",
    ONE_BOT,
    scrollToExecutionText,
    720,
  ),
];

const PHONE_STATES: ReadonlyArray<UiState> = [
  settings("phone: one update expanded", PHONE, expand, 1500),
  bell("phone: the bell's card", ONE_BOT),
];

it("instruction-updates", async () => {
  // Several sheets: a taller capture comes out blank past about 4000px.
  await captureUiStateSheet(
    "instruction-updates",
    [
      { title: "The bell", states: BELL_STATES },
      { title: "Settings → Instructions", states: SETTINGS_STATES },
    ],
    { cellWidth: 760 },
  );
  await captureUiStateSheet(
    "instruction-updates-expanded",
    [{ title: "Settings → Instructions, expanded", states: EXPANDED_STATES }],
    { cellWidth: 760 },
  );
  // A phone's viewport, so the page's `sm:` breakpoints apply as well as its container queries.
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(600, 4000);
  // The sheet is wider than that viewport; a wider body keeps its labels on its background.
  document.body.style.width = "800px";
  try {
    await captureUiStateSheet(
      "instruction-updates-phone",
      [{ title: "Phone width", states: PHONE_STATES }],
      { cellWidth: 390 },
    );
  } finally {
    document.body.style.removeProperty("width");
    await page.viewport(viewport.width, viewport.height);
  }
});
