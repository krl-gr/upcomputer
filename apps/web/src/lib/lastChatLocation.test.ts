import { describe, expect, it } from "vite-plus/test";

import { lastChatLocation, rememberChatLocation } from "./lastChatLocation";

describe("lastChatLocation", () => {
  it("keeps the last chat and ignores the new-chat index route", () => {
    rememberChatLocation("/env-1/thread-1?diff=1");
    rememberChatLocation("/");
    expect(lastChatLocation()).toBe("/env-1/thread-1?diff=1");
    rememberChatLocation("/draft/draft-1");
    expect(lastChatLocation()).toBe("/draft/draft-1");
  });
});
