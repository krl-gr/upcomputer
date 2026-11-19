import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ThreadId, type AssetResource } from "@t3tools/contracts";
import { TaskOutput } from "@t3tools/tasks-web";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../test/render";
import { AssistantMessageMarkdown } from "../components/chat/AssistantMessageMarkdown";
import { useRightPanelStore } from "../rightPanelStore";

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
});
