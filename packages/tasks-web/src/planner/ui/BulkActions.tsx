import { useGT } from "gt-react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CircleCheckIcon,
  ListPlusIcon,
  MoreHorizontalIcon,
  XIcon,
} from "lucide-react";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../../../../../apps/web/src/components/ui/menu.tsx";
import type { PlannerTask } from "../data/pendingOps.ts";
import { IconAction } from "./IconAction.tsx";
import { ProjectChip } from "./ProjectChip.tsx";
import { usePlanner } from "./plannerContext.ts";
import { isFinished } from "./TaskRow.tsx";

/**
 * The list header in select mode (wande's bulk controls): count, project,
 * status, add to the marked day, the bulk menu and exit. Every action ends
 * select mode, as in wande; bulk edits run one call per task.
 */
export function BulkActions(props: {
  readonly selected: readonly PlannerTask[];
  readonly queueDate: string | null;
  readonly onExit: () => void;
  readonly onMoveUnder: () => void;
  readonly onDelete: () => void;
}) {
  const gt = useGT();
  const { store, projects, preferences } = usePlanner();
  const ids = props.selected.map((task) => task.id);
  const firstProject = props.selected[0]?.projectId ?? null;
  const mixedProject = props.selected.some((task) => task.projectId !== firstProject);
  const finished = props.selected.filter(isFinished).length;
  const state =
    finished === 0 ? "active" : finished === props.selected.length ? "finished" : "mixed";
  const run = (action: () => Promise<unknown>) => {
    props.onExit();
    void action();
  };
  const none = ids.length === 0;
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
      <span className="ml-1 text-sm font-semibold tabular-nums text-foreground">{ids.length}</span>
      <div className="flex min-w-0 items-center gap-1">
        <ProjectChip
          projects={projects}
          value={firstProject}
          mixed={mixedProject}
          disabled={none}
          onChange={(projectId) => {
            if (!projectId) return;
            run(() =>
              Promise.all(ids.map((id) => store.updateTask(id, { projectId: projectId as never }))),
            );
          }}
        />
        {state !== "active" ? (
          <IconAction
            label={gt("Restore", { $context: "button that unarchives the selected tasks" })}
            variant="outline"
            disabled={none}
            onClick={() => run(() => store.restore(ids))}
          >
            <ArchiveRestoreIcon />
          </IconAction>
        ) : null}
        {state !== "finished" ? (
          <>
            <IconAction
              label={gt("Mark as done")}
              variant="outline"
              disabled={none}
              onClick={() => run(() => store.markDone(ids))}
            >
              <CircleCheckIcon />
            </IconAction>
            <IconAction
              label={gt("Archive", { $context: "button that archives the selected tasks" })}
              variant="outline"
              disabled={none}
              onClick={() => run(() => store.archive(ids))}
            >
              <ArchiveIcon />
            </IconAction>
          </>
        ) : null}
        {props.queueDate && preferences.weekViewMode === "queue" ? (
          <IconAction
            label={gt("Add to queue for {date}", { date: props.queueDate })}
            variant="outline"
            disabled={none}
            onClick={() =>
              run(() => store.addEntries({ taskIds: ids as never[], date: props.queueDate! }))
            }
          >
            <ListPlusIcon />
          </IconAction>
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <Button size="icon-xs" variant="outline" aria-label={gt("More bulk actions")} />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem disabled={none} onClick={() => run(() => store.reorder(ids, {}))}>
              {gt("Move tasks to top")}
            </MenuItem>
            <MenuItem disabled={none} onClick={props.onMoveUnder}>
              {gt("Move tasks under…")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" disabled={none} onClick={props.onDelete}>
              {gt("Delete tasks")}
            </MenuItem>
          </MenuPopup>
        </Menu>
        <IconAction label={gt("Exit select mode")} variant="outline" onClick={props.onExit}>
          <XIcon />
        </IconAction>
      </div>
    </div>
  );
}
