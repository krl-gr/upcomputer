import { describe, expect, it } from "vite-plus/test";

import { sanitizePersistedChatWorkspaceState } from "./workspacePersistence";

describe("workspacePersistence", () => {
  it("accepts current and legacy valid panel records", () => {
    const state = sanitizePersistedChatWorkspaceState({
      version: 1,
      dockview: { grid: {}, panels: {} },
      activePanelId: "workspace:slot-1",
      panelsById: {
        "workspace:slot-1": {
          kind: "chat",
          target: {
            kind: "thread",
            ref: { environmentId: "environment-local", threadId: "thread-1" },
          },
          diffSearch: { diff: "1" },
        },
        "workspace:slot-empty": { kind: "empty" },
      },
    });

    expect(state.activePanelId).toBe("workspace:slot-1");
    expect(state.panelsById["workspace:slot-1"]).toEqual({
      kind: "chat",
      target: {
        kind: "thread",
        ref: { environmentId: "environment-local", threadId: "thread-1" },
      },
    });
    expect(state.panelsById["workspace:slot-empty"]).toEqual({ kind: "empty" });
  });

  it("drops malformed records and an invalid active panel", () => {
    const state = sanitizePersistedChatWorkspaceState({
      version: 1,
      dockview: null,
      activePanelId: "workspace:broken",
      panelsById: {
        "workspace:broken": {
          kind: "chat",
          target: { kind: "thread", ref: { environmentId: "environment-local" } },
        },
        "chat:environment-local:thread-2": {
          kind: "chat",
          target: {
            kind: "thread",
            ref: { environmentId: "environment-local", threadId: "thread-2" },
          },
        },
      },
    });

    expect(state.panelsById).toEqual({});
    expect(state.activePanelId).toBeNull();
  });
});
