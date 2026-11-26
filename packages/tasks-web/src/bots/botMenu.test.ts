import { describe, expect, it } from "vite-plus/test";
import { botRowMenuEntries } from "./botMenu.ts";

describe("a bot row's context menu", () => {
  it("offers the chat's tasks first, only to a person who may read tasks, then settings", () => {
    expect(botRowMenuEntries(true)).toEqual(["tasks", "settings"]);
    expect(botRowMenuEntries(false)).toEqual(["settings"]);
  });
});
