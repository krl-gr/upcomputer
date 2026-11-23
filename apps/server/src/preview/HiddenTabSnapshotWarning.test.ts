import { PREVIEW_AUTOMATION_SNAPSHOT_NO_SCREENSHOT_WARNING } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  PREVIEW_AUTOMATION_SNAPSHOT_HIDDEN_TAB_WARNING,
  withHiddenTabWarning,
} from "./HiddenTabSnapshotWarning.ts";

const unpainted = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  visibleText: "Example",
  interactiveElements: [],
  accessibilityTree: "- heading",
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: null,
  warning: PREVIEW_AUTOMATION_SNAPSHOT_NO_SCREENSHOT_WARNING,
};

describe("withHiddenTabWarning", () => {
  it("explains an unpainted desktop tab that no window shows", () => {
    expect(withHiddenTabWarning(unpainted, { desktop: true, shown: false }).warning).toBe(
      PREVIEW_AUTOMATION_SNAPSHOT_HIDDEN_TAB_WARNING,
    );
  });

  it.each([
    ["a shown desktop tab", unpainted, { desktop: true, shown: true }],
    ["a server-rendered tab", unpainted, { desktop: false, shown: false }],
    [
      "a hidden tab that was painted",
      { ...unpainted, screenshot: { width: 1, height: 1 }, warning: undefined },
      { desktop: true, shown: false },
    ],
  ])("leaves %s as it is", (_name, snapshot, tab) => {
    expect(withHiddenTabWarning(snapshot, tab)).toBe(snapshot);
  });
});
