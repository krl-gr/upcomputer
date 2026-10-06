import { describe, expect, it } from "vite-plus/test";

import {
  hiddenProductCapabilities,
  isProductKeybindingCommandShown,
  isProductRightPanelSurfaceShown,
  isProductSettingsSearchItemShown,
  UPCOMPUTER_PRODUCT_FLAGS,
  UPSTREAM_PRODUCT_FLAGS,
} from "./productFlags.ts";

describe("product flags", () => {
  it("hides nothing with upstream's flags", () => {
    expect(hiddenProductCapabilities(UPSTREAM_PRODUCT_FLAGS)).toEqual({});
    for (const command of ["terminal.toggle", "script.dev.run", "pullRequest.copyNumber"]) {
      expect(isProductKeybindingCommandShown(UPSTREAM_PRODUCT_FLAGS, command)).toBe(true);
    }
    expect(isProductKeybindingCommandShown(UPSTREAM_PRODUCT_FLAGS, "thread.settle")).toBe(true);
    expect(isProductSettingsSearchItemShown(UPSTREAM_PRODUCT_FLAGS, "terminal-font")).toBe(true);
    expect(isProductRightPanelSurfaceShown(UPSTREAM_PRODUCT_FLAGS, "Device")).toBe(true);
  });

  it("turns off the pull request and settlement capabilities, keeping snooze", () => {
    expect(hiddenProductCapabilities(UPCOMPUTER_PRODUCT_FLAGS)).toEqual({
      pullRequests: false,
      pullRequestChecks: false,
      threadPullRequests: false,
      threadPullRequestWatch: false,
      pullRequestStackActions: false,
      threadPullRequestLinking: false,
      threadSettlement: false,
      threadAutoSettlement: false,
      threadAutoSettleOptOut: false,
    });
    expect(
      hiddenProductCapabilities({ ...UPSTREAM_PRODUCT_FLAGS, threadSettlement: false }),
    ).toEqual({
      threadSettlement: false,
      threadAutoSettlement: false,
      threadAutoSettleOptOut: false,
    });
  });

  it("drops the keybindings of hidden features only", () => {
    const hidden = ["terminal.toggle", "script.dev.run", "pullRequest.copyNumber"];
    for (const command of [...hidden, "thread.settle"]) {
      expect(isProductKeybindingCommandShown(UPCOMPUTER_PRODUCT_FLAGS, command)).toBe(false);
    }
    // The thread-id copy shares the PR label but is core, and snooze is kept.
    // The terminal surface keeps the shortcuts that act inside a focused terminal.
    for (const command of [
      "thread.copyReference",
      "thread.settleSomething",
      "rightPanel.toggle",
      "terminal.new",
      "terminal.split",
      "terminal.close",
    ]) {
      expect(isProductKeybindingCommandShown(UPCOMPUTER_PRODUCT_FLAGS, command)).toBe(true);
    }
  });

  it("hides every terminal shortcut, the launcher entry and the font without the terminal surface", () => {
    const flags = { ...UPCOMPUTER_PRODUCT_FLAGS, terminalSurface: false };
    for (const command of ["terminal.new", "terminal.split", "terminal.close"]) {
      expect(isProductKeybindingCommandShown(flags, command)).toBe(false);
    }
    expect(isProductRightPanelSurfaceShown(flags, "Terminal")).toBe(false);
    expect(isProductSettingsSearchItemShown(flags, "terminal-font")).toBe(false);
  });

  it("filters settings search items and right-panel launchers by flag", () => {
    expect(isProductSettingsSearchItemShown(UPCOMPUTER_PRODUCT_FLAGS, "terminal-font")).toBe(true);
    expect(isProductSettingsSearchItemShown(UPCOMPUTER_PRODUCT_FLAGS, "device-hub")).toBe(false);
    expect(
      isProductSettingsSearchItemShown(UPCOMPUTER_PRODUCT_FLAGS, "keybinding-terminal.toggle"),
    ).toBe(false);
    expect(isProductSettingsSearchItemShown(UPCOMPUTER_PRODUCT_FLAGS, "code-font")).toBe(true);
    expect(
      isProductSettingsSearchItemShown(UPCOMPUTER_PRODUCT_FLAGS, "keybinding-rightPanel.toggle"),
    ).toBe(true);
    for (const label of ["Pull request", "Linked pull requests", "Device"]) {
      expect(isProductRightPanelSurfaceShown(UPCOMPUTER_PRODUCT_FLAGS, label)).toBe(false);
    }
    for (const label of ["Browser", "Terminal", "Files", "Diff"]) {
      expect(isProductRightPanelSurfaceShown(UPCOMPUTER_PRODUCT_FLAGS, label)).toBe(true);
    }
  });
});
