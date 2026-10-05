import * as Schema from "effect/Schema";
import { SquarePenIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { productSurface } from "../product/productFlags";
import { SidebarSectionHeader, SidebarSectionHeaderAction } from "./SidebarSectionHeader";

export const SIDEBAR_THREADS_OPEN_STORAGE_KEY = "upcomputer:sidebar-threads-open";

const useSidebarThreadsOpen = () =>
  useLocalStorage(SIDEBAR_THREADS_OPEN_STORAGE_KEY, true, Schema.Boolean);

/**
 * Whether upstream's thread list shows: false only while the UpComputer
 * Threads section (surface `sidebarProjects`) is collapsed.
 */
export function useSidebarThreadListShown(): boolean {
  const [open] = useSidebarThreadsOpen();
  return productSurface("sidebarProjects") === "upstream" || open;
}

/**
 * The header of the sidebar's Threads section, over upstream's thread list.
 * It collapses the list (see `useSidebarThreadListShown`) and carries the
 * New thread action that upstream keeps in the search row.
 */
export function SidebarThreadsSectionHeader(props: {
  /** Upstream's new thread action; receives the click so Shift+click still applies. */
  readonly onNewThread: (event: ReactMouseEvent) => void;
  readonly newThreadDisabled: boolean;
  readonly newThreadShortcutLabel: string | null | undefined;
}) {
  const { onNewThread, newThreadDisabled, newThreadShortcutLabel } = props;
  const [open, setOpen] = useSidebarThreadsOpen();
  return (
    <div className="pt-2">
      <SidebarSectionHeader
        title="Threads"
        open={open}
        onToggle={() => setOpen(!open)}
        testId="sidebar-threads-toggle"
        action={
          newThreadDisabled ? null : (
            <SidebarSectionHeaderAction
              label="New thread"
              tooltip={
                newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"
              }
              onClick={onNewThread}
            >
              <SquarePenIcon className="size-3.5" />
            </SidebarSectionHeaderAction>
          )
        }
      />
    </div>
  );
}
