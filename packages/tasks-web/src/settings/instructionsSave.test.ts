import { DEFAULT_TASK_PROMPT_SETTINGS } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import { draftAfterSave, instructionsSaveInput } from "./instructionsSave.ts";

const saved = DEFAULT_TASK_PROMPT_SETTINGS;

describe("instructionsSaveInput", () => {
  it("sends only the fields edited on the page, each with the text the page loaded", () => {
    expect(
      instructionsSaveInput({
        saved,
        draft: { ...saved, taskExecution: "Page execution" },
        allChats: { text: "Page all chats", base: "Loaded all chats" },
      }),
    ).toEqual({
      taskExecution: "Page execution",
      allChats: "Page all chats",
      base: { taskExecution: saved.taskExecution, allChats: "Loaded all chats" },
    });
    expect(instructionsSaveInput({ saved, draft: saved })).toEqual({ base: {} });
  });
});

describe("draftAfterSave", () => {
  it("takes the current texts and keeps refused edits", () => {
    const draft = { ...saved, taskCreation: "Page task", taskExecution: "Page execution" };
    expect(
      draftAfterSave(draft, {
        ...saved,
        taskCreation: "Chat task",
        agentCreation: "Chat agent",
        taskExecution: "Page execution",
        conflicts: ["taskCreation"],
      }),
    ).toEqual({
      ...saved,
      taskCreation: "Page task",
      agentCreation: "Chat agent",
      taskExecution: "Page execution",
    });
  });
});
