import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { TaskAgentId } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import {
  botWriteInput,
  DEFAULT_BOT_INSTRUCTIONS,
  randomBotAppearance,
  type BotForm,
} from "./botForm.ts";

const form: BotForm = {
  id: TaskAgentId.make("bot:1"),
  name: "Iris",
  appearance: { shape: "capsule", color: "teal", accessory: "none" },
  instructions: DEFAULT_BOT_INSTRUCTIONS,
  projectId: ProjectId.make("project-1"),
  selection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-5-5" },
  runtimeMode: "full-access",
  memoryMode: "upcomputer",
};

describe("botWriteInput", () => {
  it("waits for a name, instructions, a model and a project", () => {
    expect(botWriteInput({ ...form, name: "  " })).toBeNull();
    expect(botWriteInput({ ...form, instructions: "" })).toBeNull();
    expect(botWriteInput({ ...form, selection: undefined })).toBeNull();
    expect(botWriteInput({ ...form, projectId: null })).toBeNull();
  });

  it("keeps the bot in its one project and the saved agent's other settings", () => {
    const input = botWriteInput(
      { ...form, threadId: ThreadId.make("thread-1") },
      {
        config: {
          role: "Researcher",
          instructions: "old",
          interactionMode: "plan",
          modelSelection: form.selection!,
        },
      },
    );
    expect(input).toMatchObject({
      threadId: "thread-1",
      projectId: "project-1",
      allowedProjectIds: ["project-1"],
      config: {
        role: "Researcher",
        instructions: DEFAULT_BOT_INSTRUCTIONS,
        interactionMode: "plan",
        runtimeMode: "full-access",
      },
    });
    expect(botWriteInput(form)?.config.role).toBe("Personal assistant");
  });
});

describe("randomBotAppearance", () => {
  it("draws from the whole catalog, ends included", () => {
    expect(randomBotAppearance(() => 0)).toEqual({
      shape: "drop",
      color: "gray",
      accessory: "none",
    });
    expect(randomBotAppearance(() => 0.999999)).toEqual({
      shape: "blob",
      color: "navy",
      accessory: "bunny",
    });
  });
});
