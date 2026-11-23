import "~/index.css";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId } from "@t3tools/contracts";
import type {
  Bot,
  InstructionUpdates,
  InstructionUpdateStatus,
  InstructionUpdatesUpdateInput,
} from "@t3tools/tasks-contracts/v1";
import { InstructionUpdatesSection } from "@t3tools/tasks-web/workflowUpdates";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { COMPOSER_DRAFT_STORAGE_KEY, useComposerDraftStore } from "../composerDraftStore";
import { SidebarMenu, SidebarProvider } from "../components/ui/sidebar";
import { ToastProvider } from "../components/ui/toast";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { SidebarNotifications } from "../sidebarNotifications/SidebarNotifications";
import { bot } from "../uiStates/sidebarRowFixtures";
import { render } from "../../test/render";

// The server's side, per environment: its instruction updates and bots, and what the UI saved.
const source = vi.hoisted(() => ({
  primary: null as EnvironmentId | null,
  updates: new Map<EnvironmentId, InstructionUpdates>(),
  bots: new Map<EnvironmentId, ReadonlyArray<Bot>>(),
  saved: [] as Array<InstructionUpdatesUpdateInput>,
}));

const DECIDED_AT = "2026-11-20T10:00:00.000Z";

// The Tasks server: instruction updates, bots, and the change stream's first sync.
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
        getInstructionUpdates: async () => source.updates.get(environmentId),
        updateInstructionUpdates: async (input: InstructionUpdatesUpdateInput) => {
          source.saved.push(input);
          const current = source.updates.get(environmentId)!;
          const next: InstructionUpdates = {
            mode: input.mode ?? current.mode,
            entries: current.entries.map((status) => {
              const change = input.entries?.find((entry) => entry.id === status.id);
              return change
                ? {
                    ...status,
                    state: change.state,
                    decidedAt: change.state === "kept" ? DECIDED_AT : null,
                    decidedBy: change.state === "kept" ? { kind: "person", name: null } : null,
                  }
                : status;
            }),
          };
          source.updates.set(environmentId, next);
          return next;
        },
      },
      bots: { list: async () => source.bots.get(environmentId) ?? [] },
    }),
  };
});
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePrimaryEnvironmentId: () => source.primary,
}));

const pending = (overrides: Partial<InstructionUpdateStatus> = {}): InstructionUpdateStatus => ({
  id: "task-statuses-v2",
  state: "pending",
  decidedAt: null,
  decidedBy: null,
  touchesEditedText: false,
  ...overrides,
});

/** A fresh environment per test: the stores that hold its updates and bots outlive a render. */
function setup(
  name: string,
  options: {
    readonly updates: InstructionUpdates;
    readonly bots?: ReadonlyArray<Bot>;
  },
): EnvironmentId {
  const environmentId = EnvironmentId.make(`environment-${name}`);
  source.primary = environmentId;
  source.updates.clear();
  source.bots.clear();
  source.saved.length = 0;
  source.updates.set(environmentId, options.updates);
  source.bots.set(environmentId, options.bots ?? []);
  return environmentId;
}

function Bell() {
  return (
    <AppAtomRegistryProvider>
      <ToastProvider>
        <SidebarProvider className="min-h-0">
          <div data-app-sidebar="" className="w-64">
            <SidebarMenu>
              <SidebarNotifications />
            </SidebarMenu>
          </div>
        </SidebarProvider>
      </ToastProvider>
    </AppAtomRegistryProvider>
  );
}

const TITLE = "We updated how task statuses work";

describe("the bell's instruction updates card", () => {
  it("shows one pending update, and a dismiss saves it for later", async () => {
    setup("bell-one", {
      updates: { mode: "ask", entries: [pending()] },
      bots: [bot("bot-penny", "Penny")],
    });
    await using screen = await render(<Bell />);
    const bell = screen.getByRole("button", { name: /1 instruction update/ });
    await expect.element(bell).toBeVisible();

    await userEvent.click(bell);
    await expect.element(page.getByText(TITLE)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Discuss with Penny" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "What changed" })).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    await vi.waitFor(() =>
      expect(source.saved).toEqual([{ entries: [{ id: "task-statuses-v2", state: "dismissed" }] }]),
    );
    await expect.element(page.getByText(TITLE)).not.toBeInTheDocument();
    await expect.element(page.getByText("Saved for later")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Open" })).toBeVisible();
  });

  it("has no card when nothing waits", async () => {
    setup("bell-none", { updates: { mode: "ask", entries: [pending({ state: "dismissed" })] } });
    await using screen = await render(<Bell />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await expect.element(page.getByText("You're all caught up")).toBeVisible();
    expect(page.getByText(TITLE).query()).toBeNull();
  });
});

function Section({ environmentId }: { readonly environmentId: EnvironmentId }) {
  return (
    <div className="w-180">
      <InstructionUpdatesSection environmentId={environmentId} />
    </div>
  );
}

describe("Discuss", () => {
  it("names the one bot and puts the brief in its chat's composer, unsent", async () => {
    const penny = bot("bot-penny", "Penny");
    const environmentId = setup("discuss-one-bot", {
      updates: { mode: "ask", entries: [pending()] },
      bots: [penny],
    });
    const thread = scopeThreadRef(environmentId, penny.threadId);
    using _draft = {
      [Symbol.dispose]: () => {
        useComposerDraftStore.getState().clearDraftThread(thread);
        localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
      },
    };
    await using screen = await render(<Section environmentId={environmentId} />);

    await userEvent.click(screen.getByRole("button", { name: "Discuss with Penny" }));
    await expect
      .poll(() => screen.router!.state.location.pathname)
      .toBe(`/${environmentId}/${penny.threadId}`);
    const draft = useComposerDraftStore.getState().getComposerDraft(thread);
    expect(draft?.files.map((file) => [file.name, file.mimeType])).toEqual([
      ["Task statuses update.md", "text/markdown"],
    ]);
    expect(await draft!.files[0]!.file!.text()).toContain("Change nothing until the user agrees");
    expect(draft?.prompt).toContain(
      "Help me decide how to apply this update. Look at how I work first, and change nothing until I agree.",
    );
    // Placed, not sent: nothing but the reads reached the server.
    expect(source.saved).toEqual([]);
  });

  it("offers each bot and a new chat in a menu when there are several", async () => {
    const environmentId = setup("discuss-several-bots", {
      updates: { mode: "ask", entries: [pending()] },
      bots: [bot("bot-penny", "Penny"), bot("bot-scout", "Scout")],
    });
    await using screen = await render(<Section environmentId={environmentId} />);
    await userEvent.click(screen.getByRole("button", { name: "Discuss with a bot" }));
    await expect.element(page.getByRole("menuitem", { name: "Penny" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Scout" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "New chat" })).toBeVisible();
  });

  it("offers a chat without bots", async () => {
    const environmentId = setup("discuss-no-bots", {
      updates: { mode: "ask", entries: [pending()] },
    });
    await using screen = await render(<Section environmentId={environmentId} />);
    await expect.element(screen.getByRole("button", { name: "Discuss in a chat" })).toBeVisible();
  });
});

describe("Settings → Instructions updates", () => {
  it("keeps the user's setup, then offers to reopen it", async () => {
    const environmentId = setup("settings-keep", {
      updates: { mode: "ask", entries: [pending()] },
    });
    await using screen = await render(<Section environmentId={environmentId} />);
    await expect
      .element(screen.getByRole("combobox", { name: "Instruction updates" }))
      .toHaveTextContent("Ask me");

    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(source.saved).toEqual([{ entries: [{ id: "task-statuses-v2", state: "kept" }] }]);
    await expect.element(screen.getByRole("button", { name: "Reopen" })).toBeVisible();
    const row = screen.container.querySelector<HTMLElement>("#instruction-update-task-statuses-v2");
    expect(row).toHaveAttribute("data-instruction-update", "kept");
    expect(row?.textContent).toContain("Kept yours");
  });

  it("says an update that touches edited text waits in auto mode, and marks only real changes", async () => {
    const environmentId = setup("settings-auto", {
      updates: { mode: "auto", entries: [pending({ touchesEditedText: true })] },
    });
    await using screen = await render(<Section environmentId={environmentId} />);
    await expect
      .element(screen.getByText(/Changes text you edited, so it waits for you/))
      .toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: new RegExp(TITLE) }));
    const heading = screen.getByText("Status group order", { exact: true });
    await expect.element(heading).toBeVisible();
    const lines = [
      ...heading.element().parentElement!.querySelectorAll<HTMLElement>("[data-changed]"),
    ].map((line) => [line.textContent, line.dataset.changed]);
    expect(lines.filter(([text]) => text === "Blocked")).toEqual([
      ["Blocked", "false"],
      ["Blocked", "false"],
    ]);
    expect(lines.filter(([text]) => text === "Failed")).toEqual([["Failed", "true"]]);
    await expect.element(screen.getByText("Before").first()).toBeVisible();
    await expect.element(screen.getByText("After").first()).toBeVisible();
  });
});
