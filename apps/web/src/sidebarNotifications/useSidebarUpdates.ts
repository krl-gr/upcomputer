import { plainErrorSentence } from "@t3tools/client-runtime/errors";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type ReactNode, useState } from "react";

import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
} from "../components/desktopUpdate.logic";
import { errorToastDescription } from "../components/errors/ErrorDetails";
import { downloadLocalUpdate, installLocalUpdate } from "../components/sidebar/SidebarUpdatePill";
import { useUpdateEverythingRun } from "../components/sidebar/updateEverythingRun";
import { useUpdateEverything } from "../components/sidebar/useUpdateEverything";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { ensureLocalApi } from "../localApi";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { resolveSidebarUpdateSignal } from "./sidebarNotifications.logic";

function toastError(title: string, description: ReactNode) {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

/**
 * Upstream's update control (`SidebarUpdatePill`) as state and actions for the
 * notifications button: the app's own update, Update everything for servers
 * and provider CLIs, and the run, whose capsule stays upstream's.
 */
export function useSidebarUpdates() {
  const state = useDesktopUpdateState();
  const [pending, setPending] = useState(false);
  const [confirmingEverything, setConfirmingEverything] = useState(false);
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const downloading = state?.status === "downloading";
  const localUpdateVersion =
    state && action !== "none" ? getDesktopUpdateDownloadedVersion(state) : null;
  const everything = useUpdateEverything(localUpdateVersion);
  const run = useUpdateEverythingRun();
  const runsEverything = everything.hasUpdates && !downloading;
  const bridge = window.desktopBridge;

  const checkForUpdate = () => {
    if (!bridge) return;
    setPending(true);
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (result.checked) return;
        toastError(
          "Could not check for updates",
          result.state.message ?? "Automatic updates are not available in this build.",
        );
      })
      .catch((error) => toastError("Could not check for updates", plainErrorSentence(error)))
      .finally(() => setPending(false));
  };

  const download = () => {
    if (!bridge) return;
    setPending(true);
    void downloadLocalUpdate(bridge, { notifyDownloaded: true }).finally(() => setPending(false));
  };

  const install = async () => {
    if (!bridge || !state) return;
    setPending(true);
    try {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        getDesktopUpdateInstallConfirmationMessage(state),
      );
      if (confirmed) await installLocalUpdate(bridge);
    } catch (error) {
      toastError("Could not confirm update", plainErrorSentence(error));
    }
    setPending(false);
  };

  const runEverything = async () => {
    setConfirmingEverything(false);
    setPending(true);
    const result = await settlePromise(() =>
      everything.run({
        ...(bridge && action === "download"
          ? {
              downloadLocal: (reportError) =>
                downloadLocalUpdate(bridge, { notifyDownloaded: false, reportError }),
            }
          : {}),
        ...(bridge && action !== "none"
          ? { installLocal: (reportError) => installLocalUpdate(bridge, reportError) }
          : {}),
      }),
    );
    if (result._tag === "Failure") {
      toastError(
        "Could not update everything",
        errorToastDescription(squashAtomCommandFailure(result)),
      );
    }
    setPending(false);
  };

  return {
    state,
    action,
    everything,
    run,
    runsEverything,
    pending,
    signal: resolveSidebarUpdateSignal({
      state,
      action,
      hasOtherUpdates: everything.hasUpdates,
      running: run !== null,
    }),
    checkForUpdate,
    download,
    install: () => void install(),
    confirmingEverything,
    setConfirmingEverything,
    runEverything: () => void runEverything(),
  };
}

export type SidebarUpdates = ReturnType<typeof useSidebarUpdates>;
