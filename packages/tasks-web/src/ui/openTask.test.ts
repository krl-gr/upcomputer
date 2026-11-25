import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  hostRightPanel,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../../../../apps/web/src/rightPanelStore.ts";
import { openTaskInPanel, readPanelTaskKey, setPanelTaskKey } from "./openTask.ts";

const environmentId = EnvironmentId.make("environment-1");
const chat = { environmentId, threadId: ThreadId.make("open-task-chat") };
const sideChat = { environmentId, threadId: ThreadId.make("open-task-side-chat") };

describe("opening a task beside a chat", () => {
  it("shows the Tasks panel on that task, in the panel a side chat shares with its parent", () => {
    const unhost = hostRightPanel(sideChat, chat);
    try {
      openTaskInPanel(sideChat, environmentId, "task-1");

      const panels = useRightPanelStore.getState().byThreadKey;
      expect(selectActiveRightPanelSurface(panels, chat)).toEqual(
        expect.objectContaining({ kind: "feature", featureSurfaceId: "tasks" }),
      );
      expect(readPanelTaskKey(chat)).toBe(`${environmentId}:task-1`);

      openTaskInPanel(chat, environmentId, "task-2");
      expect(readPanelTaskKey(chat)).toBe(`${environmentId}:task-2`);
    } finally {
      unhost();
      setPanelTaskKey(chat, undefined);
      useRightPanelStore.getState().close(chat);
    }
  });
});
