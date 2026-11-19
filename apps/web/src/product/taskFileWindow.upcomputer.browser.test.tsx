import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, type ProjectReadFileResult } from "@t3tools/contracts";
import { TaskOutput, WorkspaceViewLayout } from "@t3tools/tasks-web";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";

const files = vi.hoisted(() => new Map<string, string>());

vi.mock(import("~/state/assets"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const createUrl = Atom.family((_key: string) =>
    Atom.make(() =>
      AsyncResult.success({ relativeUrl: "about:blank", expiresAt: Number.MAX_SAFE_INTEGER }),
    ).pipe(Atom.keepAlive),
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
  const { EnvironmentId } = await import("@t3tools/contracts");
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
  return {
    ...(await original()),
    usePreparedConnection: () => Option.some(prepared),
    readPreparedConnection: () => prepared,
    // Every scope, file writes included: without a thread the window stays read-only anyway.
    useEnvironmentScope: () => true,
    readEnvironmentScope: () => true,
  };
});
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock(import("~/remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenState: () => ({ mode: "local-exec" }) as never,
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
vi.mock(import("~/hooks/useWorkspaceMutationRefresh"), () => ({
  useWorkspaceMutationRefresh: vi.fn(),
}));
vi.mock(import("../components/files/FileBreadcrumbs"), () => ({ FileBreadcrumbs: () => <></> }));
vi.mock(import("../components/files/projectFilesQueryState"), async (original) => ({
  ...(await original()),
  useProjectFileQuery: (
    _environmentId: unknown,
    _cwd: unknown,
    relativePath: string | null,
  ): ReturnType<
    typeof import("../components/files/projectFilesQueryState").useProjectFileQuery
  > => {
    const contents = relativePath === null ? undefined : files.get(relativePath);
    const data: ProjectReadFileResult | null =
      contents === undefined || relativePath === null
        ? null
        : { relativePath, contents, byteLength: contents.length, truncated: false };
    return {
      data,
      error: null,
      isPending: false,
      readError: null,
      isNotFile: false,
      isFile: true,
      refresh: vi.fn(),
    } as never;
  },
}));
// Chat's editable surface (with its comment gutter) would render Pierre's editor instead.
vi.mock(import("../components/files/ReadOnlySourcePreview"), () => ({
  default: (props: { readonly name: string; readonly text: string }) => (
    <div
      data-testid="read-only-source"
      className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
    >
      <pre>{props.text}</pre>
    </div>
  ),
}));

const environmentId = EnvironmentId.make("environment-1");
const READER_KEY = "t3code.renderMarkdown.reader";

function setup() {
  files.clear();
  files.set("src/app.ts", Array.from({ length: 400 }, (_, index) => `line ${index}`).join("\n"));
  files.set("docs/findings.md", "# Findings\n\nThe next step is in [the plan](plan.md).\n");
  files.set("docs/plan.md", "# Plan\n\nShip it.\n");
  const previous = localStorage.getItem(READER_KEY);
  localStorage.removeItem(READER_KEY);
  return {
    [Symbol.dispose]() {
      if (previous === null) localStorage.removeItem(READER_KEY);
      else localStorage.setItem(READER_KEY, previous);
    },
  };
}

const OUTPUT = "Changed `src/app.ts` and wrote `docs/findings.md`.";

function taskPage(onNavigateBack: () => void) {
  return (
    <WorkspaceViewLayout title="Task" onNavigateBack={onNavigateBack}>
      <TaskOutput
        text={OUTPUT}
        environmentId={environmentId}
        cwd="/repo"
        fileWindow={{ projectName: "repo" }}
      />
    </WorkspaceViewLayout>
  );
}

const fileLink = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLElement>(".chat-markdown-file-link")].find((link) =>
    link.textContent?.includes(name),
  )!;

describe("task file window", () => {
  it("opens a file link read-only; Escape closes only the window and focus returns to the link", async () => {
    using _storage = setup();
    await page.viewport(1280, 800);
    const onNavigateBack = vi.fn();
    await using screen = await render(taskPage(onNavigateBack));
    const link = fileLink(screen.container, "app.ts");

    await userEvent.click(link);
    const window = page.getByRole("dialog", { name: "File app.ts" });
    await expect.element(window).toBeInTheDocument();
    await expect.element(window.getByText("Read only")).toBeInTheDocument();
    // The read-only source view, not chat's editor with its comment gutter.
    const source = window.getByTestId("read-only-source");
    await expect.element(source).toBeInTheDocument();
    expect(source.element().textContent).toContain("line 399");
    // First focus lands in the scroller, so arrows and Page Down scroll at once.
    await vi.waitFor(() => expect(document.activeElement).toBe(source.element()));
    expect(window.getByRole("button", { name: "Open in the worker's thread" }).query()).toBeNull();

    await userEvent.keyboard("{Escape}");
    await expect.element(window).not.toBeInTheDocument();
    expect(onNavigateBack).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(link));
  });

  it("opens markdown rendered, and a link inside it moves the same window", async () => {
    using _storage = setup();
    await page.viewport(1280, 800);
    await using screen = await render(taskPage(vi.fn()));

    await userEvent.click(fileLink(screen.container, "findings.md"));
    const findings = page.getByRole("dialog", { name: "File findings.md" });
    await expect.element(findings.getByRole("heading", { name: "Findings" })).toBeInTheDocument();

    await userEvent.click(fileLink(findings.element() as HTMLElement, "plan.md"));
    const plan = page.getByRole("dialog", { name: "File plan.md" });
    await expect.element(plan.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(page.getByRole("dialog").all()).toHaveLength(1);
  });

  it("offers the worker's thread with the file's host path", async () => {
    using _storage = setup();
    await page.viewport(1280, 800);
    const onOpenInThread = vi.fn();
    await using screen = await render(
      <TaskOutput
        text={OUTPUT}
        environmentId={environmentId}
        cwd="/repo"
        fileWindow={{ projectName: "repo", onOpenInThread }}
      />,
    );

    await userEvent.click(fileLink(screen.container, "app.ts"));
    await userEvent.click(page.getByRole("button", { name: "Open in the worker's thread" }));
    expect(onOpenInThread).toHaveBeenCalledWith("/repo/src/app.ts", undefined);
  });
});
