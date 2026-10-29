import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  migratePersistedRightPanelState,
  selectThreadPanelVisibility,
  useRightPanelStore,
} from "./rightPanelStore";

// Unit tests see core with upstream's surfaces; the details card's default
// belongs to the UpComputer product's `threadDetailsCard` surface.
vi.mock("./product/productFlags", async (importOriginal) => {
  const { UPCOMPUTER_PRODUCT_SURFACES } = await import("@t3tools/shared/productFlags");
  return {
    ...(await importOriginal<typeof import("./product/productFlags")>()),
    productSurface: (surface: keyof typeof UPCOMPUTER_PRODUCT_SURFACES) =>
      UPCOMPUTER_PRODUCT_SURFACES[surface],
  };
});

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

const visibility = (ref: typeof refA) =>
  selectThreadPanelVisibility(useRightPanelStore.getState().threadPanelVisibilityByThreadKey, ref);

beforeEach(() => {
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
});

describe("thread details card under the UpComputer product", () => {
  it("is closed in every thread until the user opens it in one", () => {
    expect(visibility(refA)).toEqual({ inlineOpen: false, popoverOpen: false });
    useRightPanelStore.getState().toggleThreadPanel(refA, "inline");
    expect(visibility(refA)).toEqual({ inlineOpen: true, popoverOpen: false });
    expect(visibility(refB)).toEqual({ inlineOpen: false, popoverOpen: false });
    useRightPanelStore.getState().toggleThreadPanel(refA, "inline");
    expect(useRightPanelStore.getState().threadPanelVisibilityByThreadKey).toEqual({});
  });

  it("persists the threads where it is open, and old closed entries stay closed", async () => {
    useRightPanelStore.getState().toggleThreadPanel(refA, "inline");
    const { storage, name } = useRightPanelStore.persist.getOptions();
    const persisted = await storage!.getItem(name!);
    expect(persisted?.state).toMatchObject({
      threadPanelVisibilityByThreadKey: {
        "env-1:thread-A": { inlineOpen: true, popoverOpen: false },
      },
    });
    useRightPanelStore.setState(useRightPanelStore.getInitialState());
    await storage!.setItem(name!, persisted!);
    await useRightPanelStore.persist.rehydrate();
    expect(visibility(refA)).toEqual({ inlineOpen: true, popoverOpen: false });
    expect(visibility(refB)).toEqual({ inlineOpen: false, popoverOpen: false });

    // Upstream stored the closed threads; closed is the default now.
    expect(
      migratePersistedRightPanelState({
        threadPanelVisibilityByThreadKey: {
          "env-1:thread-A": { inlineOpen: false, popoverOpen: false },
          "env-1:thread-B": { inlineOpen: true, popoverOpen: true },
        },
      }).threadPanelVisibilityByThreadKey,
    ).toEqual({ "env-1:thread-B": { inlineOpen: true, popoverOpen: false } });
  });

  it("does not open inline when the right panel closes over an open popover", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.setThreadPanelOpen(refA, "popover", true);
    store.close(refA);
    expect(visibility(refA)).toEqual({ inlineOpen: false, popoverOpen: true });
  });
});
