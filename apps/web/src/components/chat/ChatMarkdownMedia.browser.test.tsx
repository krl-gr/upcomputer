import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { ChatMarkdownAssetImage, ChatMarkdownImage } from "./ChatMarkdownMedia";

const IMAGE_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
// Stands in for a signed URL the server no longer accepts.
const REJECTED_URL = "data:image/png;base64,AAAA";

// Every evaluation of the URL query is one mint: the first read, then one per refresh.
// `sign` returns what each mint signs, counting from 1.
const assetQuery = vi.hoisted(() => ({ mints: 0, sign: (_mint: number): string => "" }));
function setup(urls: string[] | ((mint: number) => string)) {
  assetQuery.mints = 0;
  assetQuery.sign =
    typeof urls === "function" ? urls : (mint) => urls[Math.min(mint, urls.length) - 1]!;
}
vi.mock(import("~/state/assets"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const createUrl = Atom.family((_key: string) =>
    Atom.make(() => {
      assetQuery.mints += 1;
      return AsyncResult.success({
        relativeUrl: assetQuery.sign(assetQuery.mints),
        expiresAt: Number.MAX_SAFE_INTEGER,
      });
    }).pipe(Atom.keepAlive),
  );
  const actual = await original();
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: (target: { readonly input: unknown }) => createUrl(JSON.stringify(target.input)),
    },
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
  };
});
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));

describe("ChatMarkdownAssetImage", () => {
  it("does not re-mint an unchanged workspace image's URL on remount", async () => {
    setup([IMAGE_URL]);
    const image = (
      <ChatMarkdownAssetImage
        environmentId={EnvironmentId.make("environment-1")}
        resource={{
          _tag: "workspace-file",
          threadId: ThreadId.make("thread-1"),
          path: "docs/diagram.png",
        }}
        alt="diagram"
        workspaceMutationId="mutation-1"
      />
    );

    {
      await using screen = await render(image);
      await expect.element(screen.getByRole("img", { name: "diagram" })).toBeInTheDocument();
    }
    // The first mount at a known revision re-mints the cached URL once.
    expect(assetQuery.mints).toBe(2);

    await using screen = await render(<ChatMarkdownAssetImage {...image.props} />);
    await expect.element(screen.getByRole("img", { name: "diagram" })).toBeInTheDocument();
    expect(assetQuery.mints).toBe(2);
  });

  it("re-mints once and shows the image when its signed URL no longer loads", async () => {
    setup([REJECTED_URL, IMAGE_URL]);
    await using screen = await render(
      <ChatMarkdownAssetImage
        environmentId={EnvironmentId.make("environment-1")}
        resource={{
          _tag: "media-file",
          threadId: ThreadId.make("thread-1"),
          path: "/Users/me/shots/expired.png",
        }}
        alt="expired"
      />,
    );

    await expect
      .element(screen.getByRole("img", { name: "expired" }))
      .toHaveAttribute("src", IMAGE_URL);
    expect(assetQuery.mints).toBe(2);
  });

  it("reports the image unavailable when the re-minted URL fails too, without minting again", async () => {
    // Each mint signs a new token, as the server does, so every URL is new.
    setup((mint) => `${REJECTED_URL}#token-${mint}`);
    await using screen = await render(
      <ChatMarkdownAssetImage
        environmentId={EnvironmentId.make("environment-1")}
        resource={{
          _tag: "media-file",
          threadId: ThreadId.make("thread-1"),
          path: "/Users/me/shots/broken.png",
        }}
        alt="broken"
      />,
    );

    await expect.element(screen.getByText("Image unavailable · broken")).toBeInTheDocument();
    expect(assetQuery.mints).toBe(2);
  });

  it("cancels a re-mint still waiting when the image unmounts", async () => {
    let signal: AbortSignal | undefined;
    const refreshSrc = vi.fn((abort: AbortSignal | undefined) => {
      signal = abort;
      return new Promise<string | null>(() => {});
    });
    {
      await using screen = await render(
        <ChatMarkdownImage
          src={REJECTED_URL}
          alt="waiting"
          copyMarkdown={undefined}
          standalone
          actionsSource={{ kind: "image", name: "waiting", src: REJECTED_URL }}
          refreshSrc={refreshSrc}
        />,
      );
      await expect.poll(() => refreshSrc.mock.calls.length).toBe(1);
      expect(screen.getByRole("status", { name: "Loading image" })).toBeTruthy();
    }
    expect(signal?.aborted).toBe(true);
  });
});
