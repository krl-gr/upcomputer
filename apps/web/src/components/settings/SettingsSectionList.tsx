import { ChevronRightIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { SIDEBAR_LABEL_TEXT_CLASS } from "../sidebar/sidebarTextStyles";
import { useSettingsNavigationEntries } from "./SettingsSidebarNav";

/**
 * The phone entry point to settings: the same sections as the settings
 * sidebar nav, as a tappable list. Each section replaces the list in place.
 */
export function SettingsSectionList() {
  const navigate = useNavigate();
  const entries = useSettingsNavigationEntries();

  return (
    <nav
      aria-label="Settings sections"
      className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-safe"
    >
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.key} className="border-border not-last:border-b">
              <button
                type="button"
                className="flex h-12 w-full items-center gap-3 px-3 text-left text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => void navigate({ to: entry.to as never, replace: true })}
              >
                {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
                <span className={`${SIDEBAR_LABEL_TEXT_CLASS} min-w-0 flex-1 truncate`}>
                  {entry.label}
                </span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
