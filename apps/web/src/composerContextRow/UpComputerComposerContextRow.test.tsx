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

function optionByText(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("[role=option]")).find((option) =>
    option.textContent?.includes(text),
  );
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

  it("is not shown at all with no control to show", async () => {
    // Not a git checkout, on the only (primary) environment.
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
    };
    await render(<UpComputerComposerContextRow {...rowProps({ isGitRepo: false })} />);
    expect(container.querySelector("[data-composer-context-row]")).toBeNull();

    // The scratch folder shows no checkout, even when it is a repository.
    state.serverThread = { ...state.serverThread, projectId: SCRATCH.id };
    await render(<UpComputerComposerContextRow {...rowProps()} />);
    expect(container.querySelector("[data-composer-context-row]")).toBeNull();
  });

  it("leaves the projects and the panel toggles to the header", async () => {
    state.serverThread = {
      environmentId: ENV,
      id: THREAD,
      projectId: UPCOMPUTER.id,
      worktreePath: null,
      linkedProjectIds: [KV.id],
    };
    await render(<UpComputerComposerContextRow {...rowProps()} />);
    expect(container.querySelector("[data-composer-context-row]")).not.toBeNull();
    expect(container.querySelector('[data-testid="favicon"]')).toBeNull();
    expect(byLabel("Toggle right panel")).toBeNull();
    expect(byLabel("Toggle thread details panel")).toBeNull();
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
