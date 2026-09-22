import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  createExperimentalWebProductComposition,
  WebProductCompositionProvider,
} from "../../product/WebComposition";
import type { ExperimentalWebThreadAccessoryProps } from "../../product/WebFeature";
import { SidebarThreadAccessory } from "./SidebarThreadAccessory";

const state = vi.hoisted(() => ({ canLoad: true }));
vi.mock("../../product/environmentProduct", () => ({
  useEnvironmentWebFeatureAvailability: () => ({ canLoad: state.canLoad }),
}));
const props = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("chat"),
  timeLabel: "26m",
  fallback: "26m",
};
const counts = (input: ExperimentalWebThreadAccessoryProps) => (
  <span data-thread={input.threadId}>2 · 1 · 8</span>
);

describe("sidebar thread extension", () => {
  beforeEach(() => {
    state.canLoad = true;
  });
  it("keeps the timestamp in the public composition", () => {
    expect(renderToStaticMarkup(<SidebarThreadAccessory {...props} />)).toBe("26m");
  });
  it("passes environment/thread identity to an enabled contribution", () => {
    const composition = createExperimentalWebProductComposition({
      features: [
        { id: "test", ownerId: "test", version: 1, threadAccessory: { component: counts } },
      ],
    });
    const html = renderToStaticMarkup(
      <WebProductCompositionProvider composition={composition}>
        <SidebarThreadAccessory {...props} />
      </WebProductCompositionProvider>,
    );
    expect(html).toContain('data-thread="chat"');
    expect(html).toContain("2 · 1 · 8");
    expect(html).not.toContain("26m");
  });
  it("keeps timestamps when the environment capability is unavailable", () => {
    state.canLoad = false;
    const composition = createExperimentalWebProductComposition({
      features: [
        { id: "test", ownerId: "test", version: 1, threadAccessory: { component: counts } },
      ],
    });
    expect(
      renderToStaticMarkup(
        <WebProductCompositionProvider composition={composition}>
          <SidebarThreadAccessory {...props} />
        </WebProductCompositionProvider>,
      ),
    ).toBe("26m");
  });
});
