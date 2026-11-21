import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ProjectId, ThreadId, type AssetResource } from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { TaskOutput } from "@t3tools/tasks-web";
import { readPanelTaskKey, setPanelTaskKey } from "@t3tools/tasks-web/openTask";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";
import { AssistantCitationEmbed } from "../components/chat/AssistantCitationChip";
import { AssistantMessageMarkdown } from "../components/chat/AssistantMessageMarkdown";
import type { ChatComposerHandle } from "../components/chat/ChatComposer";
import { COMPOSER_DRAFT_STORAGE_KEY, useComposerDraftStore } from "../composerDraftStore";
import { ComposerHandleContext } from "../composerHandleContext";
import { findAssistantCitationSourceAnchor } from "../lib/assistantTextSelection";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";

const IMAGE_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const assetRequests = vi.hoisted(() => [] as unknown[]);
vi.mock(import("~/state/assets"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const createUrl = Atom.family((key: string) =>
    Atom.make(() => {
      assetRequests.push(JSON.parse(key));
      return AsyncResult.success({ relativeUrl: IMAGE_URL, expiresAt: Number.MAX_SAFE_INTEGER });
    }).pipe(Atom.keepAlive),
  );
  const actual = await original();
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: (target: { readonly input: { readonly resource: unknown } }) =>
        createUrl(JSON.stringify(target.input.resource)),
    },
  };
});
vi.mock(import("~/assets/longLivedAssetUrls"), () => ({
  useLongLivedAssetUrl: () => ({
    _tag: "Success",
    url: "about:blank",
    expiresAt: Number.MAX_SAFE_INTEGER,
  }),
}));
// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
vi.mock(import("~/state/session"), async (original) => {
  const { Option } = await import("effect");
  const { PrimaryConnectionTarget } = await import("@t3tools/client-runtime/connection");
  const { AuthStandardClientScopes, EnvironmentId } = await import("@t3tools/contracts");
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("environment-1"),
    label: "Local",
    httpBaseUrl: "http://localhost:1",
    wsBaseUrl: "ws://localhost:1",
  });
  const prepared: PreparedConnection = {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization: null,
    target,
  };
  const granted = new Set<string>(AuthStandardClientScopes);
  const hasScope = (environmentId: unknown, scope: string) =>
    environmentId !== null && granted.has(scope);
  return {
    ...(await original()),
    usePreparedConnection: () => Option.some(prepared),
    readPreparedConnection: () => prepared,
    useEnvironmentScope: hasScope as never,
    readEnvironmentScope: hasScope as never,
  };
});
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
// A link with a folder opens as written once the host says the file is there.
vi.mock(import("~/state/use-atom-query-runner"), async (original) => {
  const actual = await original();
  const { AsyncResult } = await import("effect/reactivity");
  const { filesystemEnvironment } = await import("~/state/filesystem");
  const fileExists = async () => AsyncResult.success({ entries: [{ kind: "file" }] });
  return {
    ...actual,
    useAtomQueryRunner: ((family: unknown, ...rest: never[]) =>
      family === filesystemEnvironment.getMetadata
        ? fileExists
        : (actual.useAtomQueryRunner as (...args: unknown[]) => unknown)(family, ...rest)) as never,
  };
});
// The chat a task's chain started from, as this client knows it.
vi.mock(import("~/state/entities"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useThreadShell: ((ref: { readonly threadId: string } | null) =>
      ref?.threadId === "root-chat"
        ? { title: "Sidebar polish", deletedAt: null }
        : actual.useThreadShell(ref as never)) as never,
  };
});
vi.mock(import("~/remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));

const environmentId = EnvironmentId.make("environment-1");
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const panelRef = { environmentId, threadId: ThreadId.make("panel-thread") };

// Everything a reply can show that needs the host: a picture outside the project, file links
// and an html_render page.
const SAMPLE = [
  "## Result",
  "",
  "The funnel loses most people at **Agent started**.",
  "",
  "![Funnel](/Users/someone/research/funnel.png)",
  "",
  "Scripts: [capture.mjs](/Users/someone/research/capture.mjs) and `notes/plan.md`.",
  "",
  "```html-render",
  '{"attachmentId":"attachment-1","title":"First-run funnel","height":200}',
  "```",
].join("\n");

function setup() {
  assetRequests.length = 0;
}

// The rendered reply without the ids each mount generates.
const renderedReply = (container: HTMLElement) =>
  container
    .querySelector<HTMLElement>(".chat-markdown")!
    .innerHTML.replaceAll(/ id="base-ui-[^"]*"/g, "");

async function renderLoaded(element: Parameters<typeof render>[0]) {
  const screen = await render(element);
  await expect.element(screen.getByAltText("Funnel")).toHaveAttribute("src", IMAGE_URL);
  // The frame takes its color-scheme style on load; comparing earlier races it.
  await expect.element(screen.getByTitle("First-run funnel")).toHaveAttribute("style");
  return screen;
}

describe("task output", () => {
  it("renders an agent's reply the same as chat, without a thread", async () => {
    setup();
    await using chat = await renderLoaded(
      <AssistantMessageMarkdown text={SAMPLE} cwd="/repo" threadRef={threadRef} />,
    );
    await using task = await renderLoaded(
      <TaskOutput text={SAMPLE} environmentId={environmentId} cwd="/repo" />,
    );

    expect(renderedReply(task.container)).toBe(renderedReply(chat.container));
    expect(assetRequests).toEqual(
      expect.arrayContaining<AssetResource>([
        {
          _tag: "media-file",
          threadId: threadRef.threadId,
          path: "/Users/someone/research/funnel.png",
        },
        { _tag: "draft-workspace-file", cwd: "/repo", path: "/Users/someone/research/funnel.png" },
      ]),
    );
  });

  it("opens its file links in the panel beside it, by host path", async () => {
    setup();
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => {});
    await using screen = await renderLoaded(
      <TaskOutput
        text={SAMPLE}
        environmentId={environmentId}
        cwd="/repo"
        filePanelRef={panelRef}
      />,
    );
    const [script, plan] = screen.container.querySelectorAll<HTMLElement>(
      ".chat-markdown-file-link",
    );
    await act(async () => script!.click());
    await act(async () => plan!.click());

    // A relative link first looks for the file in the workspace, then opens as written.
    await vi.waitFor(() =>
      expect(openFile.mock.calls).toEqual([
        [panelRef, "/Users/someone/research/capture.mjs", undefined],
        [panelRef, "/repo/notes/plan.md", undefined],
      ]),
    );
  });

  it('replies "ok" to a whole list item in the composer beside it in one click, once', async () => {
    setup();
    let prompt = "";
    const insertTextAtEnd = vi.fn<ChatComposerHandle["insertTextAtEnd"]>((text) => {
      prompt += text;
      return true;
    });
    const citeAssistantText = vi.fn<ChatComposerHandle["citeAssistantText"]>(() => true);
    const readSnapshot = () => ({ value: prompt, cursor: 0, expandedCursor: 0, contextIds: [] });
    const composer = { current: { insertTextAtEnd, citeAssistantText, readSnapshot } as never };
    await using screen = await render(
      <ComposerHandleContext value={composer}>
        <TaskOutput
          text={LIST}
          environmentId={environmentId}
          cwd="/repo"
          filePanelRef={panelRef}
          quoteSource={quoteSource(null)}
        />
      </ComposerHandleContext>,
    );
    await replyOkTwice(screen, 'Reply "ok" in chat');

    expect(citeAssistantText).not.toHaveBeenCalled();
    expect(insertTextAtEnd).toHaveBeenCalledTimes(1);
    const [text, options] = insertTextAtEnd.mock.calls[0]!;
    expect(options).toEqual({ ensureLeadingBoundary: true });
    const citations = collectAssistantCitations(text).map(({ citation }) => citation);
    expect(citations).toEqual([
      expect.objectContaining({
        environmentId,
        taskId: "task-1",
        taskTitle: "Undo notice",
        text: "A. Tile (recommended)\nUndo stays inline",
        comment: "ok",
      }),
    ]);
    expect(findAssistantCitationSourceAnchor(document, citations[0]!)?.range.toString()).toMatch(
      /^A\. Tile \(recommended\)\s+Undo stays inline$/,
    );
  });

  it('replies "ok" in the chat the task started from, once, and opens that chat', async () => {
    setup();
    const rootRef = { environmentId, threadId: ThreadId.make("root-chat") };
    const onOpenThread = vi.fn();
    await using _draft = {
      [Symbol.asyncDispose]: async () => {
        useComposerDraftStore.getState().clearDraftThread(rootRef);
        localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
      },
    };
    await using screen = await render(
      <TaskOutput
        text={LIST}
        environmentId={environmentId}
        cwd="/repo"
        quoteSource={quoteSource(rootRef.threadId)}
        onOpenThread={onOpenThread}
      />,
    );
    await replyOkTwice(screen, 'Reply "ok" in "Sidebar polish"');

    const prompt = useComposerDraftStore.getState().getComposerDraft(rootRef)?.prompt ?? "";
    expect(collectAssistantCitations(prompt).map(({ citation }) => citation)).toEqual([
      expect.objectContaining({ taskId: "task-1", comment: "ok" }),
    ]);
    expect(onOpenThread).toHaveBeenCalledWith(environmentId, rootRef.threadId);
  });

  it("opens a quoted task beside the chat it is quoted in, and on the Tasks page elsewhere", async () => {
    setup();
    const chatRef = { environmentId, threadId: ThreadId.make("quoting-chat") };
    await using _panel = {
      [Symbol.asyncDispose]: async () => {
        setPanelTaskKey(chatRef, undefined);
        useRightPanelStore.getState().close(chatRef);
        localStorage.removeItem("t3code:right-panel-state:v2");
      },
    };
    const quote = (
      <AssistantCitationEmbed
        citation={{
          version: 1,
          environmentId,
          taskId: "task-1",
          taskTitle: "Undo notice",
          text: "A. Tile",
          start: 0,
          end: 7,
          prefix: "",
          suffix: "",
        }}
        leading
        trailing
      />
    );
    const quoteLink = { name: "Go to quoted task output: A. Tile" };

    await using chat = await renderRouted(quote, `/${environmentId}/${chatRef.threadId}`);
    await userEvent.click(chat.screen.getByRole("link", quoteLink));
    expect(chat.router.state.location.pathname).toBe(`/${environmentId}/${chatRef.threadId}`);
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, chatRef),
    ).toEqual(expect.objectContaining({ kind: "feature", featureSurfaceId: "tasks" }));
    expect(readPanelTaskKey(chatRef)).toBe(`${environmentId}:task-1`);

    await using settings = await renderRouted(quote, "/settings");
    await userEvent.click(settings.screen.getByRole("link", quoteLink));
    await vi.waitFor(() => expect(settings.router.state.location.pathname).toBe("/tasks"));
    expect(settings.router.state.location.search).toEqual({ task: `${environmentId}:task-1` });
  });
});

// The test router has no chat route, and a chat is what a quoted task opens beside.
async function renderRouted(ui: React.ReactNode, path: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const page = () => ui;
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      ["$environmentId/$threadId", "settings", "tasks"].map((routePath) =>
        createRoute({ getParentRoute: () => rootRoute, path: routePath, component: page }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const screen = await render(<RouterProvider router={router} />, { router: false });
  await expect.element(screen.getByRole("link")).toBeInTheDocument();
  return { screen, router, [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose]() };
}

const LIST = [
  "Pick one:",
  "",
  "- A. Tile (recommended)",
  "  - Undo stays inline",
  "- B. Banner",
].join("\n");

const quoteSource = (rootThreadId: ThreadId | null) => ({
  id: "task-1",
  title: "Undo notice",
  projectId: ProjectId.make("project-1"),
  rootThreadId,
});

async function replyOkTwice(screen: Awaited<ReturnType<typeof render>>, label: string) {
  for (let click = 0; click < 2; click++) {
    await userEvent.hover(screen.getByRole("listitem").first(), { position: { x: 8, y: 8 } });
    await userEvent.click(screen.getByRole("button", { name: label }));
    await expect.element(screen.getByRole("button", { name: label })).not.toBeInTheDocument();
  }
}
