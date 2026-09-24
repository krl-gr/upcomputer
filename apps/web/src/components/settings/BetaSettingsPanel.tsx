import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { PROJECT_STATUS_INDICATOR_EXPERIMENT_KEY } from "../sidebar/experiments";
import { resolveAvailableSidebarViewMode } from "../sidebar/sidebarViewMode";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export function BetaSettingsPanel() {
  // Keep the settings surface aligned with the mode the sidebar can actually
  // render. Persisted `v2` values decode for compatibility but resolve to
  // Classic until Flat view is re-enabled.
  const storedSidebarViewMode = useClientSettings((settings) => settings.sidebarViewMode);
  const sidebarViewMode = resolveAvailableSidebarViewMode(storedSidebarViewMode);
  const [projectStatusIndicatorEnabled, setProjectStatusIndicatorEnabled] = useLocalStorage(
    PROJECT_STATUS_INDICATOR_EXPERIMENT_KEY,
    false,
    Schema.Boolean,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Experiments">
        <SettingsRow
          title="Project status dot"
          description="Upstream's treatment of the collapsed project row: a coloured dot for the most urgent thread status in the project, swapping to the chevron on hover, instead of our always-visible trailing chevron. Device-local and temporary — here to compare the two in a running build."
          control={
            <Switch
              checked={projectStatusIndicatorEnabled}
              onCheckedChange={(checked) => setProjectStatusIndicatorEnabled(Boolean(checked))}
              aria-label="Show the project status dot"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Beta features">
        {sidebarViewMode === "v2" ? null : (
          <SettingsRow
            title="Sidebar v2"
            description="One flat thread list in creation order. Temporarily unavailable: the sidebar's view switcher lives inside the classic sidebar, so selecting this mode left no way back. It returns once the switcher moves into the shared sidebar chrome."
          />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
