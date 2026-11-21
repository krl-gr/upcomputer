import { EnvironmentId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";

import { promptQuotesPassage, taskQuoteTarget } from "./taskQuoteTarget.ts";

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

describe("whether a prompt already quotes a passage", () => {
  const passage: AssistantCitation = {
    version: 1,
    environmentId,
    taskId: "task-1",
    taskTitle: "Undo notice",
    text: "A. Tile",
    start: 10,
    end: 17,
    prefix: "Pick one: ",
    suffix: " B. Banner",
  };
  const quote = (citation: AssistantCitation) => `${serializeAssistantCitation(citation)} `;

  it.each([
    { name: "an empty prompt", prompt: "", expected: false },
    {
      name: "the passage with the same comment",
      prompt: quote({ ...passage, comment: "ok" }),
      expected: true,
    },
    {
      name: "the passage with a comment the person changed",
      prompt: `Thanks. ${quote({ ...passage, comment: "ok, but keep undo" })}`,
      expected: true,
    },
    { name: "the passage without a comment", prompt: quote(passage), expected: true },
    {
      name: "another passage of the same task",
      prompt: quote({ ...passage, text: "B. Banner", start: 18, end: 27 }),
      expected: false,
    },
    {
      name: "the same text from another task",
      prompt: quote({ ...passage, taskId: "task-2" }),
      expected: false,
    },
  ])("$name: $expected", ({ prompt, expected }) => {
    expect(promptQuotesPassage(prompt, { ...passage, comment: "ok" })).toBe(expected);
  });
});
