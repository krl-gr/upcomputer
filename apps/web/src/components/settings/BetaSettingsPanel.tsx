import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export function BetaSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection title="Experiments">
        <SettingsRow
          title="No experiments right now"
          description="Temporary, device-local UI experiments show up here while they are being compared in a running build."
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
