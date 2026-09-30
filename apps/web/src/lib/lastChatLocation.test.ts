import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  lastChatLocation,
  rememberChatLocation,
  resetLastChatLocationMemoryForTests,
} from "./lastChatLocation";

function createStorageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("lastChatLocation", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createStorageStub());
    resetLastChatLocationMemoryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLastChatLocationMemoryForTests();
  });

  it("is empty until a chat is opened in this tab", () => {
    expect(lastChatLocation()).toBeNull();
    rememberChatLocation("/");
    expect(lastChatLocation()).toBeNull();
  });

  it("keeps the last chat and ignores the new-chat index route", () => {
    rememberChatLocation("/env-1/thread-1?diff=1");
    rememberChatLocation("/");
    expect(lastChatLocation()).toBe("/env-1/thread-1?diff=1");
    rememberChatLocation("/draft/draft-1");
    expect(lastChatLocation()).toBe("/draft/draft-1");
  });

  it("ignores settings and other non-chat locations seen while leaving the chat", () => {
    rememberChatLocation("/env-1/thread-1");
    rememberChatLocation("/settings");
    rememberChatLocation("/settings/general");
    rememberChatLocation("/settings/general?tab=import");
    rememberChatLocation("/pair");
    rememberChatLocation("/connect/callback");
    expect(lastChatLocation()).toBe("/env-1/thread-1");
  });

  it("survives a page reload through sessionStorage", () => {
    rememberChatLocation("/env-1/thread-2#end");
    resetLastChatLocationMemoryForTests();
    expect(lastChatLocation()).toBe("/env-1/thread-2#end");
  });

  it("does not return a stored settings location", () => {
    sessionStorage.setItem("upcomputer:last-chat-location", "/settings/general");
    expect(lastChatLocation()).toBeNull();
  });

  it("works without sessionStorage", () => {
    vi.stubGlobal("sessionStorage", undefined);
    rememberChatLocation("/env-1/thread-3");
    expect(lastChatLocation()).toBe("/env-1/thread-3");
  });
});
