import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { botRowMenuEntries, canBecomeBotChat } from "./botMenu.ts";

const id = ThreadId.make("thread-chat");
const chat: Parameters<typeof canBecomeBotChat>[0] = {
  id,
  sidebarHidden: false,
  archivedAt: null,
  deletedAt: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
};

describe("turning a chat into a bot", () => {
  it("is offered for an ordinary chat, busy or not", () => {
    expect(canBecomeBotChat(chat, [])).toBe(true);
  });

  it("is not offered for chats the server always refuses", () => {
    expect(canBecomeBotChat({ ...chat, sidebarHidden: true }, [])).toBe(false);
    expect(canBecomeBotChat({ ...chat, archivedAt: "2026-10-23T10:00:00.000Z" }, [])).toBe(false);
    expect(
      canBecomeBotChat(
        {
          ...chat,
          lineage: { ...chat.lineage, parentThreadId: id, relationshipToParent: "subagent" },
        },
        [],
      ),
    ).toBe(false);
    expect(canBecomeBotChat(chat, [{ threadId: chat.id }])).toBe(false);
    expect(
      canBecomeBotChat(chat, [
        {
          threadId: ThreadId.make("bot-chat"),
          latestTaskRun: { threadId: chat.id, status: "completed" },
        },
      ]),
    ).toBe(false);
  });
});

describe("a bot row's context menu", () => {
  it("offers settings, and the chat's tasks only to a person who may read tasks", () => {
    expect(botRowMenuEntries(true)).toEqual(["settings", "tasks"]);
    expect(botRowMenuEntries(false)).toEqual(["settings"]);
  });
});
