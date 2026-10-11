import type { DesktopCliCommandState } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Settings → `up` command: puts the desktop app's bundled CLI on PATH, or takes
 * it off again. Hidden where the desktop build has no launcher to install.
 */
export function CliCommandSettingsRow() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.cliCommand;
  const [state, setState] = useState<DesktopCliCommandState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const change = useCallback(
    (action: "install" | "uninstall") => {
      if (!bridge || pending) return;
      setPending(true);
      void bridge[action]()
        .then(setState)
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: action === "install" ? "Could not install up" : "Could not remove up",
              description: error instanceof Error ? error.message : "Something went wrong.",
            }),
          );
        })
        .finally(() => setPending(false));
    },
    [bridge, pending],
  );

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? `Another up at ${state.shadowedBy} runs first in a new terminal. Remove it to use Up.computer's.`
    : !installed
      ? "Run Up.computer's CLI as `up` from any terminal."
      : state.onPath
        ? `Installed at ${state.installedPath}. Open a new terminal to use it.`
        : `Installed at ${state.installedPath}, which is not on your PATH yet. Add its folder to your PATH to run \`up\`.`;

  return (
    <SettingsRow
      {...searchableSetting("cli-command")}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? "Remove" : "Install"}
        </Button>
      }
    />
  );
}
