import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { snoozeWakeLabel } from "@t3tools/client-runtime/state/thread-settled";
import { ChatAttachmentId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { expect, it, vi } from "vite-plus/test";

import {
  DraftId,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../composerDraftStore";
import { SidebarDraftBlock } from "../components/sidebar/SidebarDraftBlock";
import { SidebarMenu, SidebarMenuItem } from "../components/ui/sidebar";
import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../keybindings";
import { SIDEBAR_MENU_SCOPE } from "../sidebarMetrics/sidebarMetrics";
import {
  SidebarCompactThreadRow,
  type SidebarCompactThreadRowProps,
} from "../sidebarThreadRow/SidebarCompactThreadRow";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";
import { BotRow } from "@t3tools/tasks-web/bots";
import { act } from "../../test/render";
import {
  ENVIRONMENT_ID,
  HOUR,
  LINKED_PROJECT_IDS,
  MINUTE,
  NOW_ISO,
  PROJECT,
  SCRATCH,
  STATUS_WIRE,
  at,
  bot,
  iso,
  threadKeyOf,
  threadShell,
  titleRegeneration,
} from "./sidebarRowFixtures";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

// Data sources, not UI: the projects, server config and bot chat shells the app would
// load, and the Tasks server's run counts. Paths, not imports: tasks-web reaches these
// modules by relative path.
vi.mock("../state/entities", async (importOriginal) => {
  const fixtures = await import("./sidebarRowFixtures");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useProjects: () => fixtures.PROJECTS,
    useServerConfigs: () =>
      new Map([
        [fixtures.ENVIRONMENT_ID, { scratchWorkspaceRoot: fixtures.SCRATCH_WORKSPACE_ROOT }],
      ]),
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

const noop = () => undefined;

function threadRowProps(
  thread: SidebarCompactThreadRowProps["thread"],
  overrides: Partial<SidebarCompactThreadRowProps> = {},
): SidebarCompactThreadRowProps {
  return {
    thread,
    variantAction: "settle",
    isPinned: false,
    dropVerb: null,
    sweepAction: null,
    snoozeWakeLabelText: null,
    isActive: false,
    jumpLabel: null,
    project: PROJECT,
    projectDisplayName: PROJECT.title,
    onThreadClick: noop,
    onThreadActivate: noop,
    onStartRename: noop,
    onRenameTitleChange: noop,
    onCommitRename: noop,
    onCancelRename: noop,
    isRenaming: false,
    renamingTitle: "",
    onContextMenu: noop,
    ...overrides,
  };
}

function threadRow(props: SidebarCompactThreadRowProps) {
  return () => (
    <ul>
      <SidebarCompactThreadRow {...props} />
    </ul>
  );
}

const ROW = "[data-testid=sidebar-row-compact]";

/** Replaces part of a zustand store's state for one state; the undo puts it back. */
function patchStore<State>(
  store: { getState: () => State; setState: (partial: Partial<State>) => void },
  patch: Partial<State>,
) {
  const previous = store.getState();
  store.setState(patch);
  return () => store.setState(previous);
}

function composerDraft(overrides: Partial<ComposerThreadDraftState>): ComposerThreadDraftState {
  return {
    prompt: "",
    images: [],
    files: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    threadContexts: [],
    environmentContexts: [],
    modelSelectionByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
    ...overrides,
  };
}

const DRAFT_ID = DraftId.make("draft-ui-states");
const draftSession: DraftSessionState = {
  threadId: threadShell("draft-thread", "").id,
  environmentId: ENVIRONMENT_ID,
  projectId: PROJECT.id,
  logicalProjectKey: `${ENVIRONMENT_ID}:${PROJECT.id}`,
  createdAt: iso(-5 * MINUTE),
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  envMode: "local",
  startFromOrigin: false,
};
const PROMPT_DRAFT = composerDraft({ prompt: "Add a dark mode toggle to the settings page" });
const ATTACHMENTS_DRAFT = composerDraft({
  files: ["design.pdf", "notes.txt"].map((name, index) => ({
    type: "file" as const,
    id: ChatAttachmentId.make(`attachment-${index}`),
    name,
    mimeType: name.endsWith(".pdf") ? "application/pdf" : "text/plain",
    sizeBytes: 2048,
    file: null,
  })),
});

function draftState(
  name: string,
  composer: ComposerThreadDraftState,
  options: { readonly active?: boolean; readonly hover?: boolean } = {},
): UiState {
  const projectKey = `${ENVIRONMENT_ID}:${PROJECT.id}`;
  return {
    name,
    setup: () =>
      patchStore(useComposerDraftStore, {
        draftsByThreadKey: { [DRAFT_ID]: composer },
        draftThreadsByThreadKey: { [DRAFT_ID]: draftSession },
      }),
    render: () => (
      <ul>
        <SidebarDraftBlock
          projectByKey={new Map([[projectKey, PROJECT]])}
          projectDisplayNameByKey={new Map([[projectKey, PROJECT.title]])}
          scopedProjectKeys={null}
          routeDraftId={options.active ? DRAFT_ID : null}
          onNavigateToDraft={noop}
          onDraftContextMenu={noop}
        />
      </ul>
    ),
    ...(options.hover ? { hover: "[data-testid=sidebar-draft-row]" } : {}),
  };
}

function botState(
  name: string,
  shown: Bot,
  options: { readonly active?: boolean; readonly hover?: boolean } = {},
): UiState {
  return {
    name,
    render: () => (
      <div className={SIDEBAR_MENU_SCOPE}>
        <SidebarMenu>
          <SidebarMenuItem>
            <BotRow
              environmentId={ENVIRONMENT_ID}
              bot={shown}
              active={options.active ?? false}
              onOpen={noop}
              onSettings={noop}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    ),
    settle: (cell) => waitForImages(cell),
    ...(options.hover ? { hover: "[data-sidebar-list-row]" } : {}),
  };
}

async function waitForImages(cell: HTMLElement) {
  await Promise.all([...cell.querySelectorAll("img")].map((image) => image.decode()));
}

async function waitForRunCounts(cell: HTMLElement) {
  await vi.waitFor(() => expect(cell.querySelector("[data-task-run-counts]")).not.toBeNull());
}

const plain = threadShell("thread-plain", "Fix flaky checkout test");
const longTitle = threadShell(
  "thread-long",
  "Investigate why the release build ships the public-only server when the dist symlink is stale",
);
// The desktop app's label for the first row; the web build binds no jump keys.
const jumpLabel = shortcutLabelForCommand(
  DEFAULT_RESOLVED_KEYBINDINGS,
  threadJumpCommandForIndex(0),
  { platform: "MacIntel", context: { isDesktop: true } },
);
if (jumpLabel === null) throw new Error("The first thread jump has no default shortcut");
const snoozedUntil = iso(14 * HOUR);
const draftThread = threadShell("thread-draft", "Polish onboarding copy");

const STATUS_STATES = Object.entries(STATUS_WIRE).map(([label, wire]): UiState => ({
  name: `status: ${label}`,
  render: threadRow(
    threadRowProps(threadShell(`thread-status-${label}`, "Refactor the sidebar list", wire)),
  ),
}));

const THREAD_STATES: ReadonlyArray<UiState> = [
  ...STATUS_STATES,
  {
    name: "pinned",
    render: threadRow(
      threadRowProps(threadShell("thread-pinned", "Release checklist", { pinnedAt: at(-HOUR) }), {
        isPinned: true,
      }),
    ),
  },
  {
    name: "task run counts (in place of the time)",
    render: threadRow(threadRowProps(threadShell("thread-runs", "Nightly dependency updates"))),
    settle: waitForRunCounts,
  },
  {
    name: "linked projects: 2 icons",
    render: threadRow(
      threadRowProps(
        threadShell("thread-linked-2", "Share the pricing table", {
          linkedProjectIds: [LINKED_PROJECT_IDS.site],
        }),
      ),
    ),
  },
  {
    name: "linked projects: 3 icons",
    render: threadRow(
      threadRowProps(
        threadShell("thread-linked-3", "Document the pricing table", {
          linkedProjectIds: [LINKED_PROJECT_IDS.site, LINKED_PROJECT_IDS.docs],
        }),
      ),
    ),
  },
  {
    name: "no project",
    render: threadRow(
      threadRowProps(threadShell("thread-scratch", "Plan the week", { projectId: SCRATCH.id }), {
        project: SCRATCH,
        projectDisplayName: null,
      }),
    ),
  },
  {
    name: "list scoped to one project (no icons)",
    setup: () =>
      patchStore(useUiStateStore, {
        sidebarProjectScopeKeys: [`${ENVIRONMENT_ID}:${PROJECT.id}`],
      }),
    render: threadRow(threadRowProps(threadShell("thread-scoped", "Fix flaky checkout test"))),
  },
  {
    name: "snoozed (wake time)",
    render: threadRow(
      threadRowProps(
        threadShell("thread-snoozed", "Follow up on the invoice", {
          snoozedUntil: at(14 * HOUR),
          snoozedAt: at(-HOUR),
        }),
        {
          variantAction: "unsnooze",
          snoozeWakeLabelText: snoozeWakeLabel(snoozedUntil, { now: NOW_ISO }),
        },
      ),
    ),
  },
  {
    name: "title regenerating",
    render: threadRow(
      threadRowProps(
        threadShell("thread-regenerating", "New chat", {
          titleRegeneration: titleRegeneration(),
        }),
      ),
    ),
  },
  { name: "long truncated title", render: threadRow(threadRowProps(longTitle)) },
  { name: "hover (… button shown)", render: threadRow(threadRowProps(plain)), hover: ROW },
  {
    name: "active",
    render: threadRow(
      threadRowProps(threadShell("thread-active", "Fix flaky checkout test"), { isActive: true }),
    ),
  },
  {
    name: "multi-selected",
    setup: () =>
      patchStore(useThreadSelectionStore, {
        selectedThreadKeys: new Set([threadKeyOf(plain)]),
      }),
    render: threadRow(threadRowProps(plain)),
  },
  {
    name: "renaming",
    render: threadRow(threadRowProps(plain, { isRenaming: true, renamingTitle: plain.title })),
  },
  {
    name: "dragging, drop badge: Pin",
    render: threadRow(
      threadRowProps(plain, {
        dropVerb: "pin",
        sortable: {
          listeners: undefined,
          setNodeRef: noop,
          transform: null,
          transition: undefined,
          isDragging: true,
        },
      }),
    ),
  },
  {
    name: "file dragged over",
    render: threadRow(threadRowProps(plain, { onFileDropThreads: noop })),
    settle: async (cell) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["notes"], "notes.txt", { type: "text/plain" }));
      const row = cell.querySelector("li");
      await act(() =>
        row?.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer })),
      );
    },
  },
  { name: `jump hint (${jumpLabel})`, render: threadRow(threadRowProps(plain, { jumpLabel })) },
  {
    name: "unsent draft (compact row draws nothing)",
    setup: () =>
      patchStore(useComposerDraftStore, {
        draftsByThreadKey: { [threadKeyOf(draftThread)]: PROMPT_DRAFT },
      }),
    render: threadRow(threadRowProps(draftThread)),
  },
  {
    name: "woke (compact row draws nothing)",
    render: threadRow(
      threadRowProps(
        threadShell("thread-woke", "Check the deploy", {
          snoozedUntil: at(-20 * MINUTE),
          snoozedAt: at(-20 * HOUR),
          lastVisitedAt: at(-2 * HOUR),
        }),
      ),
    ),
  },
];

const DRAFT_STATES: ReadonlyArray<UiState> = [
  draftState("default", PROMPT_DRAFT),
  draftState("active", PROMPT_DRAFT, { active: true }),
  draftState("hover (discard button shown)", PROMPT_DRAFT, { hover: true }),
  draftState("attachments only", ATTACHMENTS_DRAFT),
];

const BOT_STATES: ReadonlyArray<UiState> = [
  botState("idle", bot("bot-idle", "Scout")),
  botState("working", bot("bot-working", "Builder")),
  botState("needs input", bot("bot-attention", "Reviewer")),
  botState("active", bot("bot-idle", "Scout"), { active: true }),
  botState("hover (settings button shown)", bot("bot-idle", "Scout"), { hover: true }),
  { ...botState("task run counts", bot("bot-runs", "Planner")), settle: waitForRunCounts },
];

it("sidebar-rows", async () => {
  await captureUiStateSheet("sidebar-rows", [
    { title: "Compact thread row", states: THREAD_STATES },
    { title: "New-chat draft row", states: DRAFT_STATES },
    { title: "Bot row", states: BOT_STATES },
  ]);
});
