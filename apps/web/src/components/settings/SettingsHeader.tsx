import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SIDEBAR_LABEL_TEXT_CLASS } from "../sidebar/sidebarTextStyles";

/** The header title reads like the section rows, at every width. */
export const SETTINGS_HEADER_TITLE_CLASS = `${SIDEBAR_LABEL_TEXT_CLASS} min-w-0 truncate text-foreground/72 dark:text-white/82`;

export function SettingsHeaderTitle(props: { children: ReactNode }) {
  return <h1 className={SETTINGS_HEADER_TITLE_CLASS}>{props.children}</h1>;
}

/**
 * Phones have no settings sidebar: the section list is the way in, and the
 * header steps back up one level (section → list → last chat). The arrow is
 * the settings sidebar's "Back" icon.
 */
export function SettingsHeaderBackButton(props: { isSectionList: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.isSectionList ? "Back to chat" : "Back to settings"}
      className="-ms-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [-webkit-app-region:no-drag]"
      onClick={props.onClick}
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
    </button>
  );
}
