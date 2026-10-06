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
});

const { act, cloneElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
type ReactNode = import("react").ReactNode;
type ReactElement = import("react").ReactElement;

const state = vi.hoisted(() => ({
  surface: "upcomputer" as "upstream" | "upcomputer",
  projects: [] as Array<Record<string, unknown>>,
}));

vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => state.surface,
}));
vi.mock("../components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children?: ReactNode }) =>
    children === undefined ? render : cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));
vi.mock("../components/ProjectFavicon", () => ({
  ProjectFavicon: () => <span data-testid="favicon" />,
}));
vi.mock("../state/entities", () => ({
  useProjects: () => state.projects,
  useThreadShells: () => [],
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [{ environmentId: "env-1", label: "This Mac", serverConfig: null }],
  }),
  usePrimaryEnvironmentId: () => "env-1",
}));
vi.mock("../state/server", () => ({ primaryServerKeybindingsAtom: "keybindings" }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("../hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
      select(DEFAULT_CLIENT_SETTINGS),
  };
});
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: () => "env-1",
    scratchWorkspaceRootFor: () => "/scratch",
    openScratchProject: vi.fn(),
  }),
}));
vi.mock("../composerDraftStore", () => {
  const store = {
    setLogicalProjectDraftThreadId: vi.fn(),
    getComposerDraft: () => null,
    applyStickyState: vi.fn(),
    setModelSelection: vi.fn(),
  };
  return { useComposerDraftStore: (select: (value: typeof store) => unknown) => select(store) };
});

import { EnvironmentId, ProjectId } from "@t3tools/contracts";

const { DraftHeroHeadline } = await import("../components/chat/DraftHeroHeadline");

const ENV = EnvironmentId.make("env-1");
const project = (id: string, title: string, workspaceRoot: string) => ({
  id: ProjectId.make(id),
  environmentId: ENV,
  title,
  workspaceRoot,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});
const SCRATCH = project("p-scratch", "No project", "/scratch");
const UPCOMPUTER = project("p-up", "UpComputer", "/work/up");

let container: HTMLDivElement;
let root: Root;

function renderHero(activeProject: typeof SCRATCH) {
  return act(async () =>
    root.render(
      <DraftHeroHeadline
        draftId={"draft-1" as never}
        activeProjectRef={{ environmentId: ENV, projectId: activeProject.id }}
        activeProjectTitle={activeProject.title}
      />,
    ),
  );
}

const projectPicker = () => container.querySelector("[data-draft-project-trigger]");

beforeEach(() => {
  state.surface = "upcomputer";
  state.projects = [SCRATCH, UPCOMPUTER];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("the empty draft's hero", () => {
  it('leaves choosing a project to the row\'s "Add project" in a draft without one', async () => {
    await renderHero(SCRATCH);
    expect(container.querySelector("h1")?.textContent).toBe("What should we work on?");
    expect(projectPicker()).toBeNull();
    expect(container.textContent).not.toContain("No project");
  });

  it("keeps upstream's heading picker in a draft with a project", async () => {
    await renderHero(UPCOMPUTER);
    expect(container.querySelector("h1")?.textContent).toBe("What should we build in UpComputer?");
    expect(projectPicker()?.textContent).toBe("UpComputer");
    expect(container.textContent).toContain("or start without a project");
  });

  it('keeps upstream\'s "No project" picker with the upstream surface', async () => {
    state.surface = "upstream";
    await renderHero(SCRATCH);
    expect(projectPicker()?.textContent).toBe("No project");
  });
});
