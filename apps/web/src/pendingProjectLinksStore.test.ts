import { EnvironmentId, ProjectId } from "@upcomputer/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectPendingProjectLinks, usePendingProjectLinksStore } from "./pendingProjectLinksStore";

const link = { environmentId: EnvironmentId.make("env"), projectId: ProjectId.make("web") };
const other = { environmentId: EnvironmentId.make("env"), projectId: ProjectId.make("api") };

describe("pendingProjectLinksStore", () => {
  beforeEach(() => {
    usePendingProjectLinksStore.setState({ byDraftId: {} });
  });

  it("tracks links per draft without duplicates", () => {
    const store = usePendingProjectLinksStore.getState();
    store.addLink("draft-a", link);
    store.addLink("draft-a", { ...link });
    store.addLink("draft-b", other);

    const state = usePendingProjectLinksStore.getState();
    expect(selectPendingProjectLinks(state, "draft-a")).toEqual([link]);
    expect(selectPendingProjectLinks(state, "draft-b")).toEqual([other]);
    expect(selectPendingProjectLinks(state, null)).toEqual([]);
  });

  it("drops the draft entry once its last link is removed or it is cleared", () => {
    const store = usePendingProjectLinksStore.getState();
    store.addLink("draft-a", link);
    store.addLink("draft-a", other);
    store.removeLink("draft-a", link);
    expect(usePendingProjectLinksStore.getState().byDraftId["draft-a"]).toEqual([other]);
    store.removeLink("draft-a", other);
    expect("draft-a" in usePendingProjectLinksStore.getState().byDraftId).toBe(false);

    store.addLink("draft-b", link);
    store.clearDraft("draft-b");
    expect(usePendingProjectLinksStore.getState().byDraftId).toEqual({});
  });
});
