import { describe, expect, it } from "vite-plus/test";

import type { ThreadListV2ListItem } from "../../threads/threadListV2";
import { previewProjects, sidebarListItems } from "./sidebarListItems";

const thread = (key: string, pinned = false) =>
  ({ type: "v2-thread", key, item: { pinned } }) as unknown as ThreadListV2ListItem;
const shelf = { type: "v2-snoozed-shelf", key: "v2-snoozed-shelf" } as ThreadListV2ListItem;
const keys = (items: ReadonlyArray<{ readonly key: string }>) => items.map((item) => item.key);

describe("chats sidebar list", () => {
  it("heads pinned threads with Pinned and the rest with Threads, before the shelves", () => {
    const items = [thread("a", true), thread("b"), shelf, thread("snoozed")];
    expect(keys(sidebarListItems(items, { pinned: true, threads: true }))).toEqual([
      "group:pinned",
      "a",
      "group:threads",
      "b",
      "v2-snoozed-shelf",
      "snoozed",
    ]);
  });

  it("keeps a closed group's header, and shows Pinned only with a pinned thread", () => {
    const items = [thread("a", true), thread("b")];
    expect(keys(sidebarListItems(items, { pinned: false, threads: false }))).toEqual([
      "group:pinned",
      "group:threads",
    ]);
    expect(keys(sidebarListItems([thread("b")], { pinned: true, threads: true }))).toEqual([
      "group:threads",
      "b",
    ]);
  });

  it("lists three projects, the picked one taking the last place", () => {
    const projects = ["a", "b", "c", "d", "e"].map((key) => ({ key }));
    expect(keys(previewProjects(projects, null))).toEqual(["a", "b", "c"]);
    expect(keys(previewProjects(projects, "b"))).toEqual(["a", "b", "c"]);
    expect(keys(previewProjects(projects, "e"))).toEqual(["a", "b", "e"]);
  });
});
