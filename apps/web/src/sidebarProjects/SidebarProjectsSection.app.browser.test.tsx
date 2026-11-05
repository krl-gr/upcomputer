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
import { render } from "../../test/render";

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
__setClientSettingsForTests({
  ...DEFAULT_CLIENT_SETTINGS,
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
});

const scope = () => useUiStateStore.getState().sidebarProjectScopeKeys;
/** The thread rows the sidebar lists. */
const listedThreads = () =>
  [...document.querySelectorAll<HTMLElement>("[data-thread-item]")].map((row) =>
    row.dataset.threadItem?.split(":").at(-1),
  );

async function mountApp() {
  useUiStateStore.setState({ sidebarProjectScopeKeys: [] });
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
