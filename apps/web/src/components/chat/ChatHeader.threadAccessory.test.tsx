import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@upcomputer/contracts";
import {
  createExperimentalWebProductComposition,
  WebProductCompositionProvider,
} from "../../product/WebComposition";
import type { ExperimentalWebThreadAccessoryProps } from "../../product/WebFeature";
import { ChatHeader } from "./ChatHeader";

vi.mock("../../product/environmentProduct", () => ({
  useEnvironmentWebFeatureAvailability: () => ({ canLoad: true }),
}));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => null }));

const counts = ({ threadId, timeLabel, fallback }: ExperimentalWebThreadAccessoryProps) =>
  threadId === "with-runs" ? (
    <span data-thread={threadId} data-time-label={timeLabel ?? "none"}>
      2 16
    </span>
  ) : (
    fallback
  );
const composition = createExperimentalWebProductComposition({
  features: [{ id: "test", ownerId: "test", version: 1, threadAccessory: { component: counts } }],
});

const renderHeader = (threadId: string) =>
  renderToStaticMarkup(
    <WebProductCompositionProvider composition={composition}>
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("local")}
        activeThreadId={ThreadId.make(threadId)}
        activeThreadTitle="Current situation"
        activeProjectName={undefined}
        activeProjectCwd={null}
        openInCwd={null}
        keybindings={[]}
        availableEditors={[]}
        rightPanelOpen={false}
        gitCwd={null}
      />
    </WebProductCompositionProvider>,
  );

describe("chat header thread accessory", () => {
  it("renders the registered accessory after the title for a thread with runs", () => {
    const html = renderHeader("with-runs");
    expect(html).toContain('data-thread="with-runs"');
    expect(html).toContain('data-time-label="none"');
    expect(html.indexOf("Current situation")).toBeLessThan(html.indexOf("2 16"));
  });

  it("renders nothing in the slot for a thread without runs", () => {
    const html = renderHeader("no-runs");
    expect(html).not.toContain("data-thread=");
    expect(html).toMatch(/<span data-chat-header-thread-accessory="true" class="[^"]*"><\/span>/);
  });
});
