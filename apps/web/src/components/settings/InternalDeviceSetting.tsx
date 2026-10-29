import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Switch } from "../ui/switch";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Marks the selected environment's usage data as a team or test device. */
export function InternalDeviceSetting() {
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment) return null;
  return <InternalDeviceRow key={environment.environmentId} />;
}

function InternalDeviceRow() {
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const canEdit = useAtomValue(
    serverEnvironment.setTelemetryInternalDevice.permissionAtom(environmentId),
  );
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const getInternalDevice = useAtomCommand(serverEnvironment.getTelemetryInternalDevice, {
    reportFailure: false,
  });
  const setInternalDevice = useAtomCommand(serverEnvironment.setTelemetryInternalDevice);

  useEffect(() => {
    if (!environmentId) return;
    let current = true;
    void getInternalDevice({ environmentId, input: {} }).then((result) => {
      if (current && result._tag === "Success") setEnabled(result.value.enabled);
    });
    return () => {
      current = false;
    };
  }, [environmentId, getInternalDevice]);

  return (
    <SettingsSection title="Product usage data" id="product-usage-data">
      <SettingsRow
        title="Internal device"
        description="Marks usage data from this environment as internal, so the Up.computer team can leave it out of product numbers. Turn it on only on team or test devices."
        control={
          <Switch
            checked={enabled === true}
            disabled={enabled === null || saving || !canEdit || !environmentId}
            aria-label="Internal device"
            onCheckedChange={(checked) => {
              if (!environmentId) return;
              setSaving(true);
              // The React Compiler skips components with try/finally.
              void setInternalDevice({ environmentId, input: { enabled: checked } })
                .then((result) => {
                  if (result._tag === "Success") setEnabled(result.value.enabled);
                })
                .finally(() => setSaving(false));
            }}
          />
        }
      />
    </SettingsSection>
  );
}
