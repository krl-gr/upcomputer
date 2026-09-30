import type { ComponentType } from "react";

export interface SettingsNavigationEntry {
  readonly key: string;
  readonly label: string;
  readonly to: string;
  readonly icon: ComponentType<{ className?: string }> | undefined;
}

interface CoreSettingsItem {
  readonly label: string;
  readonly to: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly hideFromNavigation?: boolean;
}

interface FeatureSettingsPage {
  readonly feature: { readonly id: string };
  readonly page: {
    readonly id: string;
    readonly label: string;
    readonly path: string;
    readonly icon?: ComponentType<{ readonly className?: string }>;
    readonly hideFromNavigation?: boolean;
  };
}

/**
 * The settings sections shown in navigation, in menu order: the first core
 * section (General), then product-contributed pages, then the remaining core
 * sections. Both the settings sidebar and the mobile section list use it.
 */
export function resolveSettingsNavigationEntries(input: {
  readonly coreItems: ReadonlyArray<CoreSettingsItem>;
  readonly featurePages: ReadonlyArray<FeatureSettingsPage>;
}): SettingsNavigationEntry[] {
  const core = input.coreItems
    .filter((item) => !item.hideFromNavigation)
    .map((item) => ({ key: item.to, label: item.label, to: item.to, icon: item.icon }));
  const features = input.featurePages
    .filter(({ page }) => !page.hideFromNavigation)
    .map(({ feature, page }) => ({
      key: `${feature.id}:${page.id}`,
      label: page.label,
      to: page.path,
      icon: page.icon,
    }));
  return [...core.slice(0, 1), ...features, ...core.slice(1)];
}

export const SETTINGS_SECTION_LIST_PATH = "/settings";
export const DEFAULT_SETTINGS_SECTION_PATH = "/settings/general";

/**
 * What `/settings` shows. Phones (the same breakpoint as the sidebar sheet)
 * get the list of sections; wider screens keep the sidebar nav and open
 * General.
 */
export function resolveSettingsIndexTarget(input: {
  readonly isMobile: boolean;
}): "section-list" | typeof DEFAULT_SETTINGS_SECTION_PATH {
  return input.isMobile ? "section-list" : DEFAULT_SETTINGS_SECTION_PATH;
}
