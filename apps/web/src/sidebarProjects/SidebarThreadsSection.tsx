import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { SquarePenIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { useSidebar } from "../components/ui/sidebar";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useScratchProject } from "../hooks/useScratchProject";
import { productSurface } from "../product/productFlags";
import { usePrimaryEnvironmentId } from "../state/environments";
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
 * Under the `sidebarProjects` surface, New thread (the Threads pencil and
 * `chat.new`) opens an empty chat without a project, as V1 did; the project is
 * picked inside the chat. It uses upstream's "No project" path, the scratch
 * project. The legacy sidebar keeps upstream's New thread.
 */
export function newThreadStartsWithoutProject(legacySidebarEnabled: boolean): boolean {
  return !legacySidebarEnabled && productSurface("sidebarProjects") === "upcomputer";
}

/**
 * The header of the sidebar's Threads section, over upstream's thread list.
 * It collapses the list (see `useSidebarThreadListShown`) and carries the
 * New thread action that upstream keeps in the search row.
 */
export function SidebarThreadsSectionHeader(props: {
  /** Upstream's new thread action, for Shift+click and when no environment offers a chat without a project. */
  readonly onNewThread: (event?: ReactMouseEvent) => void;
  /** The environment of the open thread or draft, if any. */
  readonly currentEnvironmentId: EnvironmentId | null;
  /** Upstream's disabled state (no projects); a chat without a project needs none. */
  readonly newThreadDisabled: boolean;
  readonly newThreadShortcutLabel: string | null | undefined;
}) {
  const { onNewThread, currentEnvironmentId, newThreadDisabled, newThreadShortcutLabel } = props;
  const [open, setOpen] = useSidebarThreadsOpen();
  const { isMobile, setOpenMobile } = useSidebar();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  // The same target as the command palette's "No project" item.
  const scratchTarget = scratchEnvironmentId(currentEnvironmentId ?? primaryEnvironmentId);
  const handleNewThread = (event: ReactMouseEvent) => {
    // Shift+click runs upstream's plain click: the "New thread in..." picker
    // with several projects, the one project otherwise.
    if (event.shiftKey || scratchTarget === null) {
      onNewThread();
      return;
    }
    if (isMobile) setOpenMobile(false);
    void startScratchThread(scratchTarget);
  };
  return (
    <div className="pt-2">
      <SidebarSectionHeader
        title="Threads"
        open={open}
        onToggle={() => setOpen(!open)}
        testId="sidebar-threads-toggle"
        action={
          newThreadDisabled && scratchTarget === null ? null : (
            <SidebarSectionHeaderAction
              label="New thread"
              tooltip={
                newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"
              }
              onClick={handleNewThread}
            >
              <SquarePenIcon className="size-3.5" />
            </SidebarSectionHeaderAction>
          )
        }
      />
    </div>
  );
}
