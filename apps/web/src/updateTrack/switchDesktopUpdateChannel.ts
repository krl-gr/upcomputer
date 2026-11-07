import type { DesktopUpdateChannel } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "../components/ui/toast";

/**
 * Moves only this app to another update track. Up.computer's releases come from its own update
 * feed, so connected machines are not looked up on npm or switched with it.
 */
export function switchDesktopUpdateChannel(channel: DesktopUpdateChannel): void {
  const bridge = window.desktopBridge;
  if (!bridge) return;
  void bridge.setUpdateChannel(channel).catch((error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not change update track",
        description: error instanceof Error ? error.message : "Update track change failed.",
      }),
    );
  });
}
