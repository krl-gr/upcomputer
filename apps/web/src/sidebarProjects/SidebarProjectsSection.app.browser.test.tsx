import { createMemoryHistory } from "@tanstack/react-router";
import { ProjectId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import type * as Context from "effect/Context";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { useUiStateStore } from "~/uiStateStore";
import {
  ENVIRONMENT_ID,
  fakeProject,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";
import { ALL_PROJECTS_ROW_KEY } from "./sidebarProjects.logic";

// The whole app on the in-process environment of test/fakeEnvironment.ts, as in
// test/appScenarios.renders.tsx: the Projects section filters upstream's thread list,
// whose route reveal can widen the scope again, so only the real Sidebar shows a pick stick.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

// The open thread is in the environment's own project; five more projects fill More.
const NAMES = ["alpha", "bravo", "charlie", "delta", "echo"];
const OPEN = threadWithHistory("thread-open", 1);
installFakeEnvironment(
  [
    OPEN,
    ...NAMES.map((name) => ({
      ...threadWithHistory(`thread-${name}`, 1),
      projectId: ProjectId.make(name),
    })),
  ],
  { projects: NAMES.map(fakeProject) },
);
await page.viewport(1400, 900);

const scope = () => useUiStateStore.getState().sidebarProjectScopeKeys;
/** The thread rows the sidebar lists. */
const listedThreads = () =>
  [...document.querySelectorAll<HTMLElement>("[data-thread-item]")].map((row) =>
    row.dataset.threadItem?.split(":").at(-1),
  );

/** A pointer drag in steps: dnd-kit starts past its distance and finds the target on later moves. */
async function drag(source: Element, target: Element) {
  const center = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const from = center(source);
  const to = center(target);
  const pointer = (type: string, point: { x: number; y: number }, on: EventTarget) =>
    on.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 1,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  await act(() => pointer("pointerdown", from, source));
  for (let step = 1; step <= 8; step++) {
    const point = { x: from.x, y: from.y + ((to.y - from.y) * step) / 8 };
    await act(() => pointer("pointermove", point, document));
  }
  await act(() => pointer("pointerup", to, document));
}

async function mountApp(sidebarProjectSortOrder: "updated_at" | "manual" = "updated_at") {
  // A returning user: the first-run gate would otherwise wait on onboarding evidence.
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    sidebarProjectSortOrder,
  });
  useUiStateStore.setState({ sidebarProjectScopeKeys: [], projectOrder: [] });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${OPEN.id}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 1400px;";
  const screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect.element(page.getByText("All projects", { exact: true })).toBeVisible();
  return screen;
}

describe("Projects section More", () => {
  it("filters to a project picked in More while another project's thread is open", async () => {
    await using _app = await mountApp();
    await userEvent.click(page.getByText("More", { exact: true }));
    await userEvent.click(page.getByRole("option", { name: /delta/ }));
    // The thread list follows the pick, and nothing widens the scope back to All projects.
    await expect.poll(listedThreads).toEqual(["thread-delta"]);
    expect(scope()).toEqual([`${ENVIRONMENT_ID}:/workspace/delta`]);
  });

  it("drags All projects among the projects in the manual order", async () => {
    await using _app = await mountApp("manual");
    const top = (label: string) =>
      page.getByText(label, { exact: true }).element().getBoundingClientRect().top;
    // A fresh manual order: All projects first, then the projects as the environment lists them.
    expect(top("All projects")).toBeLessThan(top("alpha"));
    await drag(
      page.getByText("All projects", { exact: true }).element(),
      page.getByText("alpha", { exact: true }).element(),
    );
    await expect
      .poll(() => useUiStateStore.getState().projectOrder.indexOf(ALL_PROJECTS_ROW_KEY))
      .toBe(2);
    expect(top("alpha")).toBeLessThan(top("All projects"));
    // The drop is not a click: the scope stays All projects.
    expect(scope()).toEqual([]);
  });

  it("filters to a project picked in More of the sidebar's icon mode", async () => {
    await using _app = await mountApp();
    // sidebar.toggle switches the adaptive sidebar between full and icons.
    const mod = isMacPlatform(navigator.platform) ? "Meta" : "Control";
    await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
    await expect
      .poll(() =>
        document.querySelector("[data-sidebar-compact]")?.getAttribute("data-sidebar-compact"),
      )
      .toBe("true");
    await userEvent.click(page.getByRole("combobox", { name: "More projects" }));
    await userEvent.click(page.getByRole("option", { name: /echo/ }));
    await expect.poll(listedThreads).toEqual(["thread-echo"]);
    expect(scope()).toEqual([`${ENVIRONMENT_ID}:/workspace/echo`]);
  });
});
