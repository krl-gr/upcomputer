import {
  PREVIEW_AUTOMATION_SNAPSHOT_NO_SCREENSHOT_WARNING,
  type PreviewAutomationSnapshot,
  type PreviewAutomationSnapshotMetadata,
} from "@t3tools/contracts";

export const PREVIEW_AUTOMATION_SNAPSHOT_HIDDEN_TAB_WARNING =
  "This snapshot has no screenshot: the browser tab is not on screen in the Up.computer window (its thread is not the one open there), and this computer did not paint it in the background. Its text, accessibility tree and refs are still valid. To get a screenshot, ask the user to open this thread in Up.computer and snapshot again.";

/** Says why a desktop tab that no window shows came back without pixels, and what fixes it. */
export function withHiddenTabWarning<
  S extends PreviewAutomationSnapshot | PreviewAutomationSnapshotMetadata,
>(snapshot: S, tab: { readonly desktop: boolean; readonly shown: boolean }): S {
  return tab.desktop &&
    !tab.shown &&
    snapshot.warning === PREVIEW_AUTOMATION_SNAPSHOT_NO_SCREENSHOT_WARNING
    ? { ...snapshot, warning: PREVIEW_AUTOMATION_SNAPSHOT_HIDDEN_TAB_WARNING }
    : snapshot;
}
