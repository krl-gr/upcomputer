import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { taskQuoteTarget } from "./taskQuoteTarget.ts";

const environmentId = EnvironmentId.make("environment-1");
const panel = { environmentId, threadId: ThreadId.make("panel-thread") };
const rootThreadId = ThreadId.make("root-chat");

describe("where a quote from a task's output goes", () => {
  it.each([
    {
      name: "beside a thread: that thread, even when the task has a root chat",
      besideThreadRef: panel,
      rootThreadId,
      rootThread: { title: "Root" },
      expected: { kind: "beside", threadRef: panel },
    },
    {
      name: "on the Tasks page: the chat the chain started from",
      besideThreadRef: undefined,
      rootThreadId,
      rootThread: { title: "Sidebar polish" },
      expected: {
        kind: "root",
        threadRef: { environmentId, threadId: rootThreadId },
        title: "Sidebar polish",
      },
    },
    {
      name: "a task no chat created: a new chat",
      besideThreadRef: undefined,
      rootThreadId: null,
      rootThread: null,
      expected: { kind: "new-chat" },
    },
    {
      name: "a root chat this client does not know or that was deleted: a new chat",
      besideThreadRef: undefined,
      rootThreadId,
      rootThread: null,
      expected: { kind: "new-chat" },
    },
  ])("$name", ({ besideThreadRef, rootThreadId, rootThread, expected }) => {
    expect(taskQuoteTarget({ besideThreadRef, environmentId, rootThreadId, rootThread })).toEqual(
      expected,
    );
  });
});
