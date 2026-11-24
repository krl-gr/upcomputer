import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, TelemetryPreference } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { useEffect, useState } from "react";

import { setServerRelayTelemetry } from "../../cloud/publicConfig";
import { PRIVACY_POLICY_URL } from "../../legalLinks";
import { managedTelemetryOffMessage, usePrimaryManagedPolicy } from "../../state/managedPolicy";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Switch } from "../ui/switch";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

/** The install's "Share anonymous usage data" switch, kept by this computer's server. */
export function UsageDataSettingRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const messages = useMessages();
  const setting = useSearchableSetting();
  const policyOff = managedTelemetryOffMessage(usePrimaryManagedPolicy(), messages);
  const canEdit = useAtomValue(
    serverEnvironment.setTelemetryPreference.permissionAtom(environmentId),
  );
  const [preference, setPreference] = useState<TelemetryPreference | null>(null);
  const [saving, setSaving] = useState(false);
  const getPreference = useAtomCommand(serverEnvironment.getTelemetryPreference, {
    reportFailure: false,
  });
  const savePreference = useAtomCommand(serverEnvironment.setTelemetryPreference);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the server's saved choice
  useEffect(() => {
    let current = true;
    void getPreference({ environmentId, input: {} }).then((result) => {
      if (current && result._tag === "Success") setPreference(result.value);
    });
    return () => {
      current = false;
    };
  }, [environmentId, getPreference]);

  const lockedReason =
    preference?.lockedBy === "policy"
      ? (policyOff ?? gt("Your organization turned off anonymous usage data."))
      : preference?.lockedBy === "environment"
        ? gt("Turned off by the UPCOMPUTER_TELEMETRY_ENABLED environment variable.")
        : undefined;

  return (
    <SettingsRow
      {...setting("usage-data")}
      description={
        lockedReason ?? (
          <T>
            Basic usage stats and error reports, never your chats, files or passwords. See the{" "}
            <a
              className="underline decoration-current/40 underline-offset-2 hover:text-foreground"
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              privacy policy
            </a>
            .
          </T>
        )
      }
      control={
        <Switch
          checked={preference?.enabled === true}
          disabled={preference === null || preference.lockedBy !== null || saving || !canEdit}
          aria-label={gt("Share anonymous usage data")}
          onCheckedChange={(checked) => {
            setSaving(true);
            // The React Compiler skips components with try/finally.
            void savePreference({ environmentId, input: { enabled: checked } })
              .then((result) => {
                if (result._tag !== "Success") return;
                setPreference(result.value);
                // Relay traces from this window stop or resume with it.
                setServerRelayTelemetry(result.value.enabled);
              })
              .finally(() => setSaving(false));
          }}
        />
      }
    />
  );
}
