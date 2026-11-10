import { plainErrorSentence } from "@t3tools/client-runtime/errors";
import {
  type DesktopBridge,
  type DesktopUpdateState,
  PROVIDER_DISPLAY_NAMES,
} from "@t3tools/contracts";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type ReactNode, useState } from "react";

import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
} from "../components/desktopUpdate.logic";
import { errorToastDescription } from "../components/errors/ErrorDetails";
import { downloadLocalUpdate, installLocalUpdate } from "../components/sidebar/SidebarUpdatePill";
import { runningThreadCountAtom } from "../components/sidebar/UpdateEverythingDialog";
import { useUpdateEverythingRun } from "../components/sidebar/updateEverythingRun";
import { useUpdateEverything } from "../components/sidebar/useUpdateEverything";
import {
  collectProviderUpdateCandidates,
  hasOneClickUpdateProviderCandidate,
  type ProviderUpdateCandidate,
} from "../components/ProviderUpdateLaunchNotification.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { ensureLocalApi } from "../localApi";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentProviders, useEnvironments } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { resolveSidebarUpdateSignal } from "./sidebarNotifications.logic";

function toastError(title: string, description: ReactNode) {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

/** Installs the downloaded app update, which quits the app, once the user confirms it. */
export async function confirmAndInstallLocalUpdate(
  bridge: DesktopBridge,
  state: DesktopUpdateState,
) {
  try {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      getDesktopUpdateInstallConfirmationMessage(state),
    );
    if (confirmed) await installLocalUpdate(bridge);
  } catch (error) {
    toastError("Could not confirm update", plainErrorSentence(error));
  }
}

export interface ProviderUpdateCard {
  readonly key: string;
  readonly name: string;
  /** Set when updates come from more than one computer. */
  readonly machineLabel: string | null;
  readonly provider: ProviderUpdateCandidate;
  readonly update: () => void;
}

/**
 * Provider CLIs one click can update, one card each. Unlike Update everything's
 * list, a provider stays while its own update runs, so its card can show it.
 */
function useProviderUpdateCards(): ReadonlyArray<ProviderUpdateCard> {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    failureToast: "Could not update the provider",
  });
  const machines = environments.flatMap((environment) => {
    if (environment.connection.phase !== "connected") return [];
    const providers = providersByEnvironment.get(environment.environmentId) ?? [];
    const candidates = collectProviderUpdateCandidates(providers).filter((candidate) =>
      hasOneClickUpdateProviderCandidate(candidate, providers),
    );
    return candidates.length > 0 ? [{ environment, candidates }] : [];
  });
  return machines.flatMap(({ environment, candidates }) =>
    candidates.map((provider) => ({
      key: `${environment.environmentId}:${provider.instanceId}`,
      name: PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
      machineLabel: machines.length > 1 ? environment.label : null,
      provider,
      update: () =>
        void updateProvider({
          environmentId: environment.environmentId,
          input: { provider: provider.driver, instanceId: provider.instanceId },
        }),
    })),
  );
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
  const providers = useProviderUpdateCards();
  const configs = useServerConfigs();
  // Update everything lists the servers it would update only as rows of its plan.
  const servers = everything.rows.flatMap((row) =>
    row.environmentId !== null && (row.app === "server" || row.app === "desktop-app")
      ? [
          {
            environmentId: row.environmentId,
            label: row.label,
            version: configs.get(row.environmentId)?.environment.serverVersion ?? null,
          },
        ]
      : [],
  );

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
    await confirmAndInstallLocalUpdate(bridge, state);
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

  // The dialog only warns that running threads stop or this app restarts; without either, go.
  const updateEverything = () => {
    const restartsThisApp = everything.rows.some((row) => row.app === "this-app");
    const runningThreads = appAtomRegistry.get(
      runningThreadCountAtom(
        everything.restarts.map((machine) => machine.environmentId).join("\n"),
      ),
    );
    if (restartsThisApp || runningThreads > 0) setConfirmingEverything(true);
    else void runEverything();
  };

  return {
    state,
    action,
    everything,
    run,
    runsEverything,
    providers,
    servers,
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
    updateEverything,
  };
}

export type SidebarUpdates = ReturnType<typeof useSidebarUpdates>;
