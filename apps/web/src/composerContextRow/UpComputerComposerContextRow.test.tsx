import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The jsdom test environment cannot load this repo's test setup (it imports
// `node:sea`), so the DOM is installed by hand before React and Base UI load.
await vi.hoisted(async () => {
  // @ts-expect-error jsdom ships no type declarations and this repo has no @types/jsdom.
  const { JSDOM } = await import("jsdom");
  const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const source = window as unknown as Record<string, unknown>;
  // Node's own event classes cannot be dispatched on jsdom nodes.
  const replaced = new Set(["navigator", "Event", "CustomEvent", "EventTarget"]);
  for (const key of Object.getOwnPropertyNames(window)) {
    if (replaced.has(key) || !(key in globalThis)) {
      Object.defineProperty(globalThis, key, { configurable: true, value: source[key] });
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  // Base UI's combobox waits for its popup's animations.
  window.Element.prototype.getAnimations = () => [];
  // Upstream's context strip measures its labels.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(window.document, "fonts", {
    configurable: true,
    value: { addEventListener: () => undefined, removeEventListener: () => undefined },
  });
});

const { act, cloneElement, createRef, useImperativeHandle } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
type ReactNode = import("react").ReactNode;
type ReactElement = import("react").ReactElement;

const state = vi.hoisted(() => ({
  surface: "upcomputer" as "upstream" | "upcomputer",
  serverThread: null as Record<string, unknown> | null,
  draftThread: null as Record<string, unknown> | null,
  projects: [] as Array<Record<string, unknown>>,
  scratchRoot: "/scratch",
  updateMetadata: vi.fn(async (_input: unknown) => ({ _tag: "Success" })),
  retargetDraft: vi.fn(),
  setDraftThreadContext: vi.fn(),
  branchSelector: vi.fn(),
  openBranchPicker: vi.fn(),
}));

vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => state.surface,
}));
// Tooltips render their text next to the trigger, so a test can read it.
vi.mock("../components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children?: ReactNode }) =>
    children === undefined ? render : cloneElement(render, undefined, children),
  TooltipPopup: ({ children }: { children: ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}));
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: ({ project }: { project: { title: string } }) => (
    <span data-testid="favicon">{project.title.slice(0, 2).toUpperCase()}</span>
  ),
}));
vi.mock("../state/entities", () => {
  const byRef = (ref: { projectId: string } | null) =>
    ref === null ? null : (state.projects.find((project) => project.id === ref.projectId) ?? null);
  return {
    useThreadShell: () => state.serverThread,
    useProject: byRef,
    useProjects: () => state.projects,
    useThreadShells: () => [],
    useThreadShellsForProjectRefs: () => [],
  };
});
vi.mock("../composerDraftStore", () => {
  const store = {
    getDraftSession: () => state.draftThread,
    getDraftThreadByRef: () => state.draftThread,
    setDraftThreadContext: state.setDraftThreadContext,
  };
  return { useComposerDraftStore: (select: (value: typeof store) => unknown) => select(store) };
});
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({ scratchWorkspaceRootFor: () => state.scratchRoot }),
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: "updateMetadata" } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.updateMetadata }));
vi.mock("./useRetargetDraftToProject", () => ({
  useRetargetDraftToProject: () => state.retargetDraft,
}));
// Upstream's branch selector loads refs from the server; the stub records what
// the row hands it and exposes the same `open` handle.
vi.mock("../components/BranchToolbarBranchSelector", () => ({
  BranchToolbarBranchSelector: (props: {
    ref?: import("react").Ref<{ open: () => void }>;
    showPullRequestBadge?: boolean;
  }) => {
    state.branchSelector(props);
    useImperativeHandle(props.ref, () => ({ open: state.openBranchPicker }));
    return (
      <span
        data-testid="branch-selector"
        data-pr-badge={String(props.showPullRequestBadge ?? true)}
      >
        <button type="button">main</button>
      </span>
    );
  },
}));

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { BranchToolbarHandle } from "../components/BranchToolbar";
import type { UpComputerComposerContextRowProps } from "./UpComputerComposerContextRow";

const { UpComputerComposerContextRow } = await import("./UpComputerComposerContextRow");
const { BranchToolbar } = await import("../components/BranchToolbar");
const { PanelLayoutControls } = await import("../components/chat/PanelLayoutControls");
const { Popover, PopoverCreateHandle, PopoverPopup } = await import("../components/ui/popover");
const { composerShortcutScope, showsUpComputerComposerContextRow } =
  await import("./composerContextRowSurface");

const ENV = EnvironmentId.make("env-1");
const THREAD = ThreadId.make("thread-1");

const project = (id: string, title: string, workspaceRoot = `/work/${id}`) => ({
  id,
  environmentId: ENV,
  title,
  workspaceRoot,
});
const UPCOMPUTER = project("p-up", "UpComputer");
const KV = project("p-kv", "Kv store");
const RELAY = project("p-relay", "Relay");
const SCRATCH = project("p-scratch", "No project", "/scratch");

function rowProps(
  overrides: Partial<UpComputerComposerContextRowProps> = {},
): UpComputerComposerContextRowProps {
  return {
    environmentId: ENV,
    threadId: THREAD,
    isGitRepo: true,
    forceNewWorktree: false,
    envMode: "local",
    onEnvModeChange: vi.fn(),
    envLocked: false,
    startFromOrigin: false,
    onStartFromOriginChange: vi.fn(),
    rightPanelOpen: false,
    rightPanelAvailable: true,
    rightPanelShortcutLabel: "⌘B",
    onToggleRightPanel: vi.fn(),
    threadPanel: {
      open: false,
      presentation: "inline",
      popoverHandle: PopoverCreateHandle(),
      shortcutLabel: "⌘I",
      hasAttention: false,
      onToggle: vi.fn(),
    },
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function render(element: ReactElement) {
  return act(async () => root.render(element));
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function byLabel(label: string) {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

/** The text a user sees in an element, without the tooltips this file renders inline. */
function visibleText(element: Element | null) {
  const copy = element?.cloneNode(true) as Element | undefined;
  copy?.querySelectorAll("[data-testid=tooltip]").forEach((tooltip) => tooltip.remove());
  return copy?.textContent;
}

function buttonByText(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

function optionByText(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("[role=option]")).find((option) =>
    option.textContent?.includes(text),
  );
}

function projectIcons() {
  const projects = container.querySelector("[data-context-row-projects]")!;
  return Array.from(
    projects.querySelectorAll<HTMLElement>("button, span[data-context-row-own-project]"),
  ).map((element) => element.getAttribute("aria-label") ?? element.textContent);
}

beforeEach(() => {
  state.surface = "upcomputer";
  state.serverThread = null;
  state.draftThread = null;
  state.projects = [UPCOMPUTER, KV, RELAY, SCRATCH];
  state.updateMetadata.mockClear();
  state.retargetDraft.mockClear();
  state.setDraftThreadContext.mockClear();
  state.branchSelector.mockClear();
  state.openBranchPicker.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("the row under the composer", () => {
  it("shows the chat's project and its linked projects, and + links another one", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
      linkedProjectIds: [KV.id, "deleted-project"],
    };
    await render(<UpComputerComposerContextRow {...rowProps()} />);

    expect(projectIcons()).toEqual(["UP", "Unlink Kv store", "Link a project"]);

    await click(byLabel("Link a project")!);
    // Only projects the chat has not got yet, and never the scratch folder.
    expect(
      Array.from(document.querySelectorAll("[role=option]")).map((o) => o.textContent),
    ).toEqual(["RERelay"]);
    await click(optionByText("Relay")!);
    expect(state.updateMetadata).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { threadId: THREAD, linkProjectIds: [RELAY.id] },
    });
  });

  it("unlinks a linked project from its icon", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
      linkedProjectIds: [KV.id],
    };
    await render(<UpComputerComposerContextRow {...rowProps()} />);
    await click(byLabel("Unlink Kv store")!);
    expect(state.updateMetadata).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { threadId: THREAD, unlinkProjectIds: [KV.id] },
    });
  });

  it('shows V1\'s "Add project" for a chat without a project, and choosing moves the draft there', async () => {
    state.draftThread = {
      environmentId: ENV,
      projectId: SCRATCH.id,
      worktreePath: null,
    };
    const draftId = "draft-1" as UpComputerComposerContextRowProps["draftId"] & string;
    await render(<UpComputerComposerContextRow {...rowProps({ draftId })} />);

    // Text, not the bare `+`.
    expect(projectIcons()).toEqual(["Add project"]);
    const addProject = container.querySelector<HTMLElement>("[data-context-row-project-picker]")!;
    expect(visibleText(addProject)).toBe("Add project");
    expect(addProject.querySelector("svg")).toBeNull();
    // No checkout or branch: the scratch folder is not a project checkout.
    expect(container.querySelector("[data-context-row-workspace]")?.childElementCount).toBe(0);
    expect(container.querySelector('[data-testid="branch-selector"]')).toBeNull();

    // The same menu `+` opens, with "New project…" for a project not added yet.
    await click(addProject);
    expect(
      Array.from(document.querySelectorAll("[role=option]"))
        .map((o) => o.textContent)
        .toSorted(),
    ).toEqual(["KVKv store", "RERelay", "UPUpComputer"]);
    expect(buttonByText("New project…")).toBeDefined();
    await click(optionByText("Kv store")!);
    expect(state.retargetDraft).toHaveBeenCalledWith(draftId, KV);
    expect(state.updateMetadata).not.toHaveBeenCalled();
  });

  it("goes back to the project icons and + once a chat without a project links one", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: SCRATCH.id,
      worktreePath: null,
      linkedProjectIds: [],
    };
    await render(<UpComputerComposerContextRow {...rowProps()} />);
    expect(visibleText(container.querySelector("[data-context-row-projects]"))).toBe("Add project");
    await click(container.querySelector("[data-context-row-project-picker]")!);
    await click(optionByText("Kv store")!);
    expect(state.updateMetadata).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { threadId: THREAD, linkProjectIds: [KV.id] },
    });

    state.serverThread = { ...state.serverThread, linkedProjectIds: [KV.id] };
    await render(<UpComputerComposerContextRow {...rowProps()} />);
    expect(projectIcons()).toEqual(["Unlink Kv store", "Add project"]);
    expect(
      container.querySelector("[data-context-row-project-picker]")?.querySelector("svg"),
    ).not.toBeNull();
  });

  it("hides + in an unsent chat that already has a project", async () => {
    state.draftThread = { environmentId: ENV, projectId: UPCOMPUTER.id, worktreePath: null };
    await render(<UpComputerComposerContextRow {...rowProps({ draftId: "draft-2" as never })} />);
    expect(projectIcons()).toEqual(["UP"]);
  });

  it("puts upstream's checkout mode and branch after the project, with upstream's actions", async () => {
    state.draftThread = { environmentId: ENV, projectId: UPCOMPUTER.id, worktreePath: null };
    const onEnvModeChange = vi.fn();
    const onStartFromOriginChange = vi.fn();
    const ref = createRef<BranchToolbarHandle>();
    await render(
      <UpComputerComposerContextRow
        {...rowProps({
          ref,
          onEnvModeChange,
          onStartFromOriginChange,
          draftId: "draft-3" as never,
        })}
      />,
    );

    const workspace = container.querySelector("[data-context-row-workspace]")!;
    expect(visibleText(workspace)).toBe("Current checkoutmain");
    await click(workspace.querySelector('[aria-label="Workspace"]')!);
    await click(optionByText("New worktree")!);
    expect(onEnvModeChange).toHaveBeenCalledWith("worktree");

    const branchProps = state.branchSelector.mock.calls.at(-1)?.[0];
    expect(branchProps).toMatchObject({
      environmentId: ENV,
      threadId: THREAD,
      effectiveEnvModeOverride: "local",
      onStartFromOriginChange,
      showPullRequestBadge: false,
    });
    // The composer.branch shortcut reaches the branch picker through the row.
    ref.current?.openBranchPicker();
    expect(state.openBranchPicker).toHaveBeenCalledOnce();
  });

  it("shows a started thread's locked checkout as V1's label", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
    };
    await render(<UpComputerComposerContextRow {...rowProps({ envLocked: true })} />);
    expect(visibleText(container.querySelector("[data-context-row-workspace]"))).toBe(
      "Local checkoutmain",
    );
  });

  it("keeps exactly one right-panel toggle, in the row", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
    };
    const onToggleRightPanel = vi.fn();
    const header = () => (
      <PanelLayoutControls
        terminalAvailable
        terminalOpen={false}
        terminalShortcutLabel={null}
        threadPanelOpen={false}
        threadPanelPresentation="inline"
        threadPanelShortcutLabel={null}
        threadPanelHasAttention={false}
        rightPanelAvailable
        rightPanelOpen={false}
        rightPanelShortcutLabel={null}
        onToggleTerminal={vi.fn()}
        onToggleThreadPanel={vi.fn()}
        onToggleRightPanel={vi.fn()}
        // As ChatView passes it.
        showRightPanelControl={!showsUpComputerComposerContextRow()}
      />
    );
    await render(
      <>
        {header()}
        <UpComputerComposerContextRow {...rowProps({ onToggleRightPanel })} />
      </>,
    );
    const toggles = container.querySelectorAll('[aria-label="Toggle right panel"]');
    expect(toggles).toHaveLength(1);
    expect(toggles[0]?.closest("[data-composer-context-row]")).not.toBeNull();
    await click(toggles[0]!);
    expect(onToggleRightPanel).toHaveBeenCalledOnce();

    state.surface = "upstream";
    await render(header());
    expect(container.querySelectorAll('[aria-label="Toggle right panel"]')).toHaveLength(1);
  });

  it("moves upstream's thread details toggle into the row, just left of the panel toggle", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
    };
    const onToggle = vi.fn();
    const header = () => (
      <PanelLayoutControls
        terminalAvailable
        terminalOpen={false}
        terminalShortcutLabel={null}
        threadPanelOpen={false}
        threadPanelPresentation="inline"
        threadPanelShortcutLabel={null}
        threadPanelHasAttention={false}
        rightPanelAvailable
        rightPanelOpen={false}
        rightPanelShortcutLabel={null}
        onToggleTerminal={vi.fn()}
        onToggleThreadPanel={vi.fn()}
        onToggleRightPanel={vi.fn()}
        // As ChatView passes them while the row is shown.
        showThreadPanelControl={!showsUpComputerComposerContextRow()}
        showRightPanelControl={!showsUpComputerComposerContextRow()}
      />
    );
    const threadPanel = { ...rowProps().threadPanel, open: true, onToggle };
    await render(
      <>
        {header()}
        <UpComputerComposerContextRow {...rowProps({ threadPanel })} />
      </>,
    );
    const toggles = container.querySelectorAll<HTMLElement>(
      '[aria-label="Toggle thread details panel"]',
    );
    expect(toggles).toHaveLength(1);
    const details = toggles[0]!;
    expect(details.closest("[data-composer-context-row]")).not.toBeNull();
    // Immediately left of the right-panel toggle, at the row's right edge.
    const row = container.querySelector("[data-composer-context-row]")!;
    const rightCluster = row.lastElementChild!;
    expect(
      Array.from(rightCluster.querySelectorAll("button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Toggle thread details panel", "Toggle right panel"]);
    // Drawn like the row's other icons, dim until hovered, bright while open.
    expect(details.className).toContain("text-muted-foreground");
    expect(details.className).toContain("hover:text-foreground");
    expect(details.getAttribute("aria-pressed")).toBe("true");
    expect(details.nextElementSibling?.textContent).toBe("Toggle thread details (⌘I)");
    await click(details);
    expect(onToggle).toHaveBeenCalledOnce();

    state.surface = "upstream";
    await render(header());
    expect(container.querySelectorAll('[aria-label="Toggle thread details panel"]')).toHaveLength(
      1,
    );
  });

  it("opens upstream's thread details popover from the row while the card is a popover", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
    };
    const popoverHandle = PopoverCreateHandle();
    const onToggle = vi.fn();
    await render(
      <>
        <Popover handle={popoverHandle}>
          <PopoverPopup>
            <span data-testid="thread-details">Thread details</span>
          </PopoverPopup>
        </Popover>
        <UpComputerComposerContextRow
          {...rowProps({
            threadPanel: {
              ...rowProps().threadPanel,
              presentation: "popover",
              popoverHandle,
              onToggle,
            },
          })}
        />
      </>,
    );
    await click(byLabel("Toggle thread details panel")!);
    expect(document.querySelector('[data-testid="thread-details"]')).not.toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("with the upstream surface", () => {
  it("keeps upstream's context strip and its shortcut scope", async () => {
    state.surface = "upstream";
    state.draftThread = { environmentId: ENV, projectId: UPCOMPUTER.id, worktreePath: null };
    expect(showsUpComputerComposerContextRow()).toBe(false);

    await render(
      <div data-chat-composer-stack="true">
        <div data-slot="composer-shell">
          <form />
          <BranchToolbar
            environmentId={ENV}
            threadId={THREAD}
            showGitControls
            draftId={"draft-4" as never}
            onEnvModeChange={vi.fn()}
            envMode="local"
            startFromOrigin={false}
            onStartFromOriginChange={vi.fn()}
            envLocked={false}
          />
        </div>
      </div>,
    );
    const strip = container.querySelector('[data-slot="composer-context-strip"]');
    expect(strip?.textContent).toContain("Current checkout");
    expect(
      container.querySelector('[data-testid="branch-selector"]')?.getAttribute("data-pr-badge"),
    ).toBe("true");
    const form = container.querySelector("form");
    expect(composerShortcutScope(form)?.getAttribute("data-slot")).toBe("composer-shell");

    state.surface = "upcomputer";
    expect(composerShortcutScope(form)?.getAttribute("data-chat-composer-stack")).toBe("true");
  });
});
