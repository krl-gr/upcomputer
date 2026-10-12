import { useAtomValue } from "@effect/atom-react";
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import { useEffect, useMemo, useState } from "react";

import {
  disableWebPush,
  enableWebPush,
  readWebPushEnabled,
  readWebPushEnvironment,
  resolveWebPushVapidPublicKey,
  webPushDeviceLabel,
  webPushSupport,
} from "../../cloud/webPush";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Agent alerts on this browser while Up.computer is closed. Builds without a VAPID key hide it. */
export function WebPushSettings() {
  const vapidPublicKey = resolveWebPushVapidPublicKey();
  if (isElectron || !vapidPublicKey) return null;
  return <WebPushSettingsRow vapidPublicKey={vapidPublicKey} />;
}

function WebPushSettingsRow({ vapidPublicKey }: { readonly vapidPublicKey: string }) {
  const session = useAtomValue(managedRelaySessionAtom);
  const accountId = session?.accountId ?? null;
  const environment = useMemo(() => readWebPushEnvironment(isElectron), []);
  const support = webPushSupport(environment);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (support !== "supported" || !accountId) return;
    let cancelled = false;
    void readWebPushEnabled(accountId).then(
      (value) => !cancelled && setEnabled(value),
      () => !cancelled && setEnabled(false),
    );
    return () => {
      cancelled = true;
    };
  }, [accountId, support]);

  const description =
    message ??
    (support === "needs-home-screen"
      ? "Add Up.computer to your Home Screen, then open it from there to get notifications on this device."
      : support !== "supported"
        ? "This browser cannot receive push notifications. Use a current browser over HTTPS."
        : !session
          ? "Sign in to Up.computer Connect in Connections to get agent alerts here while Up.computer is closed."
          : enabled
            ? "Agent alerts reach this device while Up.computer is closed."
            : "Get alerts when an agent finishes, fails, or needs input or approval, even while Up.computer is closed.");

  const toggle = async () => {
    if (!session) return;
    setBusy(true);
    setMessage(null);
    try {
      if (enabled) {
        await disableWebPush(session);
        setEnabled(false);
      } else {
        const result = await enableWebPush({
          session,
          vapidPublicKey,
          label: webPushDeviceLabel(environment),
        });
        if (result === "denied") {
          setMessage(
            "Allow notifications for Up.computer in your browser or system settings, then try again.",
          );
        }
        setEnabled(result === "enabled");
      }
    } catch (error) {
      console.error("[web-push] Updating notifications on this device failed", error);
      setMessage(
        enabled
          ? "Notifications are off on this device, but Up.computer Connect could not be updated."
          : "Could not turn on notifications on this device. Try again.",
      );
      setEnabled(enabled ? false : await readWebPushEnabled(session.accountId).catch(() => false));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("web-push-notifications")}
      description={description}
      control={
        support === "supported" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!session || busy || enabled === null}
            onClick={() => void toggle()}
          >
            {enabled ? "Turn off on this device" : "Enable on this device"}
          </Button>
        ) : null
      }
    />
  );
}
