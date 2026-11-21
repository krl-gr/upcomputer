import { T, useGT, useMessages, Var } from "gt-react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { SettingResetButton, SettingsRow } from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { productRightPanelSurfaces } from "./ProductSlots";
import { useHiddenRightPanelSurfaces } from "./rightPanelSurfaceVisibility";

/**
 * Appearance: which of the features' surfaces (the Tasks views) the right
 * panel's menu offers, in the shape of the thread details row above it.
 */
export function RightPanelSurfacesSettingsRow() {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const surfaces = productRightPanelSurfaces();
  const { hidden, setShown, reset } = useHiddenRightPanelSurfaces();
  if (surfaces.length === 0) return null;
  const enabled = surfaces.filter((surface) => !hidden.includes(surface.id)).length;
  const isDefault = enabled === surfaces.length;
  return (
    <SettingsRow
      {...searchableSetting("panel-menu-tasks")}
      description={gt(
        "Choose which task views the right panel's menu offers. Tabs that are already open stay open.",
      )}
      resetAction={
        isDefault ? null : (
          <SettingResetButton ariaLabel={gt("Reset the panel menu to default")} onClick={reset} />
        )
      }
      control={
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between sm:w-40"
                aria-label={gt("Tasks in the panel menu: {enabled} of {total} on", {
                  enabled,
                  total: surfaces.length,
                })}
              />
            }
          >
            <T>
              <Var>{enabled}</Var> of <Var>{surfaces.length}</Var> on
            </T>
            <ChevronDownIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>
                <T>Show in the panel menu</T>
              </MenuGroupLabel>
              {surfaces.map((surface) => (
                <MenuCheckboxItem
                  key={surface.id}
                  checked={!hidden.includes(surface.id)}
                  onCheckedChange={(checked) => setShown(surface.id, checked)}
                >
                  {m(surface.label)}
                </MenuCheckboxItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuItem disabled={isDefault} onClick={reset}>
              <T>Reset to default</T>
            </MenuItem>
          </MenuPopup>
        </Menu>
      }
    />
  );
}
