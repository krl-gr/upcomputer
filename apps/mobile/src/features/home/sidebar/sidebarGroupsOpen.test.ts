import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({}));

import { DEFAULT_SIDEBAR_GROUPS_OPEN, decodeSidebarGroupsOpen } from "./sidebarGroupsOpen";

describe("sidebar groups open state", () => {
  it("keeps each stored group and falls back per group", () => {
    expect(decodeSidebarGroupsOpen(null)).toEqual(DEFAULT_SIDEBAR_GROUPS_OPEN);
    expect(decodeSidebarGroupsOpen("not json")).toEqual(DEFAULT_SIDEBAR_GROUPS_OPEN);
    expect(decodeSidebarGroupsOpen('{"projects":true,"bots":"yes"}')).toEqual({
      ...DEFAULT_SIDEBAR_GROUPS_OPEN,
      projects: true,
    });
  });
});
