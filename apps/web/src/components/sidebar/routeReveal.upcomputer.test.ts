import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { resolveSidebarRouteReveal, type SidebarRouteReveal } from "./routeReveal";

describe("resolveSidebarRouteReveal: a scope judged once per route", () => {
  const scopedProjectKeys = new Set(["environment-test:project-scoped"]);
  const hidden = makeThreadFixture({ projectId: ProjectId.make("project-other") });
  const hiddenKey = "environment-test:thread-test";
  const findThread = (key: string) => (key === hiddenKey ? hidden : undefined);
  const resolver =
    (reveal: SidebarRouteReveal) => (keys: ReadonlySet<string> | null, projectsReady?: boolean) =>
      resolveSidebarRouteReveal({
        reveal,
        routeKey: hiddenKey,
        isSearching: false,
        scopedProjectKeys: keys,
        delegatedUnderParent: new Set(),
        findThread,
        ...(projectsReady === undefined ? {} : { projectsReady }),
      });

  it("keeps a scope picked later on the same route, though the thread's row never mounted", () => {
    // A bot's chat is open: Threads lists no row for it, so its reveal stays pending.
    // Readiness is true even with a computer offline, since the Sidebar reads settled shells.
    for (const projectsReady of [undefined, true]) {
      const resolve = resolver({ observedKey: "environment-test:other", pendingKey: null });
      expect(resolve(null, projectsReady)).toEqual({ pendingKey: hiddenKey, widensScope: false });
      expect(resolve(scopedProjectKeys, projectsReady)).toEqual({
        pendingKey: hiddenKey,
        widensScope: false,
      });
    }
  });

  it("widens for a stored scope whose project loads after the thread", () => {
    // The stored scope's project is on a computer still connecting, so it reads as All projects.
    const resolve = resolver({ observedKey: "environment-test:other", pendingKey: null });
    expect(resolve(null, false)).toEqual({ pendingKey: hiddenKey, widensScope: false });
    expect(resolve(scopedProjectKeys, true)).toEqual({ pendingKey: hiddenKey, widensScope: true });
  });
});
