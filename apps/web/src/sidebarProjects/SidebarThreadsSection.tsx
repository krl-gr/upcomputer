import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { SquarePenIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { SidebarCompactNewThread } from "../adaptiveSidebar/adaptiveSidebar";
import { SidebarMenu, useSidebar } from "../components/ui/sidebar";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { productSurface } from "../product/productFlags";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { usePrimaryEnvironmentId } from "../state/environments";
import { cn } from "../lib/utils";
import {
  SIDEBAR_FIXED_HEADER_END_GAP,
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
} from "../sidebarMetrics/sidebarMetrics";
import { SidebarEmptyRow } from "./SidebarEmptyRow";
import { SidebarSectionHeader, SidebarSectionHeaderAction } from "./SidebarSectionHeader";
import { useIsScratchProjectGroup } from "./sidebarProjectIcons";

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
 * project. The boring sidebar keeps upstream's New thread.
 */
export function newThreadStartsWithoutProject(boringSidebarEnabled: boolean): boolean {
  return !boringSidebarEnabled && productSurface("sidebarProjects") === "upcomputer";
}

/** Upstream's new thread action, and where the open thread or draft is. */
interface NewThreadProps {
  /** Upstream's new thread action, for Shift+click and when no environment offers a chat without a project. */
  readonly onNewThread: (event?: ReactMouseEvent) => void;
  /** The environment of the open thread or draft, if any. */
  readonly currentEnvironmentId: EnvironmentId | null;
}

/** The Threads header's New thread: a chat without a project, where one can start. */
function useNewThreadWithoutProject({ onNewThread, currentEnvironmentId }: NewThreadProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  // The same target as the command palette's "No project" item.
  const scratchTarget = scratchEnvironmentId(currentEnvironmentId ?? primaryEnvironmentId);
  const start = (event?: ReactMouseEvent) => {
    // Shift+click runs upstream's plain click: the "New thread in..." picker
    // with several projects, the one project otherwise.
    if (event?.shiftKey || scratchTarget === null) {
      onNewThread();
      return;
    }
    if (isMobile) setOpenMobile(false);
    void startScratchThread(scratchTarget);
  };
  return { start, available: scratchTarget !== null };
}

/**
 * The header of the sidebar's Threads section, over upstream's thread list.
 * It collapses the list (see `useSidebarThreadListShown`) and carries the
 * New thread action that upstream keeps in the search row.
 */
export function SidebarThreadsSectionHeader(
  props: NewThreadProps & {
    /** Upstream's disabled state (no projects); a chat without a project needs none. */
    readonly newThreadDisabled: boolean;
    readonly newThreadShortcutLabel: string | null | undefined;
  },
) {
  const { newThreadDisabled, newThreadShortcutLabel } = props;
  const [open, setOpen] = useSidebarThreadsOpen();
  const newThread = useNewThreadWithoutProject(props);
  const newThreadTooltip = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";
  const newThreadShown = !(newThreadDisabled && !newThread.available);
  return (
    <div
      data-sidebar-threads-section=""
      className={cn(SIDEBAR_SECTION_GAP, SIDEBAR_FIXED_HEADER_END_GAP)}
    >
      <SidebarSectionHeader
        title="Threads"
        open={open}
        onToggle={() => setOpen(!open)}
        testId="sidebar-threads-toggle"
        action={
          newThreadShown ? (
            <SidebarSectionHeaderAction
              label="New thread"
              track="sidebar.new_thread"
              tooltip={newThreadTooltip}
              onClick={newThread.start}
            >
              <SquarePenIcon />
            </SidebarSectionHeaderAction>
          ) : null
        }
      />
      {newThreadShown ? (
        <SidebarCompactNewThread tooltip={newThreadTooltip} onClick={newThread.start} />
      ) : null}
    </div>
  );
}

/**
 * Upstream's empty thread list. Under the `sidebarProjects` surface, with the
 * workspace loaded, it is one row like an empty section's: New thread in the
 * filter's project, or where the header's New thread starts one. Otherwise it
 * is upstream's own notice, `children`.
 */
export function SidebarThreadListEmpty(
  props: NewThreadProps & {
    /** The sidebar waits for an environment; upstream's notice says so. */
    readonly waiting: boolean;
    readonly scopedProjectGroups: ReadonlyArray<SidebarProjectSnapshot>;
    readonly children: ReactNode;
  },
) {
  if (props.waiting || productSurface("sidebarProjects") !== "upcomputer") {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
        {props.children}
      </div>
    );
  }
  return <NewThreadRow {...props} />;
}

function NewThreadRow(
  props: NewThreadProps & { readonly scopedProjectGroups: ReadonlyArray<SidebarProjectSnapshot> },
) {
  const { isMobile, setOpenMobile } = useSidebar();
  const handleNewThread = useNewThreadHandler();
  const isScratch = useIsScratchProjectGroup();
  const withoutProject = useNewThreadWithoutProject(props);
  // Several selected projects start it in the first, so it stays in the filtered list.
  const project = props.scopedProjectGroups[0];
  const named = props.scopedProjectGroups.length === 1 && project && !isScratch(project);
  return (
    <div className={SIDEBAR_MENU_SCOPE}>
      <SidebarMenu>
        <SidebarEmptyRow
          label={named ? `New thread in ${project.displayName}` : "New thread"}
          onClick={() => {
            if (!project) return withoutProject.start();
            if (isMobile) setOpenMobile(false);
            void handleNewThread(scopeProjectRef(project.environmentId, project.id));
          }}
        />
      </SidebarMenu>
    </div>
  );
}
