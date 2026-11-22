import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { addressableBots } from "./botRecipients.ts";

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
