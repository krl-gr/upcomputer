import { useGT, useMessages } from "gt-react";

import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { Switch } from "../components/ui/switch";
import { productRightPanelSurfaces } from "./ProductSlots";
import { useHiddenRightPanelSurfaces } from "./rightPanelSurfaceVisibility";

/**
 * Appearance: a switch for each of the features' surfaces (the Tasks views),
 * which takes it out of the right panel's menu. Open tabs stay open.
 */
export function RightPanelSurfacesSettingsSection() {
  const gt = useGT();
  const m = useMessages();
  const section = useSearchableSetting()("panel-menu-tasks");
  const surfaces = productRightPanelSurfaces();
  const { hidden, setShown } = useHiddenRightPanelSurfaces();
  if (surfaces.length === 0) return null;
  return (
    <SettingsSection id={section.id} title={section.title}>
      {surfaces.map((surface) => {
        const label = m(surface.label);
        const shown = !hidden.includes(surface.id);
        return (
          <SettingsRow
            key={surface.id}
            title={label}
            description={surface.description === undefined ? undefined : m(surface.description)}
            resetAction={
              shown ? null : (
                <SettingResetButton
                  ariaLabel={gt("Reset {label} to default", { label })}
                  onClick={() => setShown(surface.id, true)}
                />
              )
            }
            control={
              <Switch
                checked={shown}
                onCheckedChange={(checked) => setShown(surface.id, Boolean(checked))}
                aria-label={gt("Show {label} in the panel menu", { label })}
              />
            }
          />
        );
      })}
    </SettingsSection>
  );
}
