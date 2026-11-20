import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { addressableBots, botMessageTurn } from "./botRecipients.ts";

const environmentId = EnvironmentId.make("environment-local");
const nova = { name: "Nova", threadId: ThreadId.make("thread-nova") };
const release = { name: "Release helper", threadId: ThreadId.make("thread-release") };

describe("bots a chat can address with @", () => {
  it("offers every bot in an ordinary chat", () => {
    expect(addressableBots([nova, release], ThreadId.make("thread-chat"))).toEqual([nova, release]);
  });

  it("leaves out the bot whose chat it is, so its own name sends there once", () => {
    expect(addressableBots([nova, release], nova.threadId)).toEqual([release]);
  });
});

describe("a message sent to a bot", () => {
  it("goes to the bot's chat with the chat's modes, queued behind a busy turn", () => {
    expect(
      botMessageTurn({
        environmentId,
        bot: release,
        chat: { runtimeMode: "approval-required", interactionMode: "plan" },
        text: "prepare version 2.1",
        messageId: MessageId.make("message-1"),
        createdAt: "2026-11-20T10:00:00.000Z",
      }),
    ).toEqual({
      environmentId,
      input: {
        threadId: release.threadId,
        message: {
          messageId: "message-1",
          role: "user",
          text: "prepare version 2.1",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: "plan",
        dispatchMode: "queue",
        createdAt: "2026-11-20T10:00:00.000Z",
      },
    });
  });
});
