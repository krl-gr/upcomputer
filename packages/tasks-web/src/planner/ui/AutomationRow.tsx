import { memo, useCallback, type MouseEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronRightIcon, MoreVerticalIcon } from "lucide-react";
import type { TaskAutomationListItem } from "@t3tools/tasks-contracts/v1";

import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { describeCron } from "../../ui/automationCalendarSchedule.ts";
import { TablePill } from "../../ui/TablePill.tsx";
import { AUTOMATION_STATUS_LABELS, shortDateTime } from "../logic/automationForm.ts";
import { IconAction } from "./IconAction.tsx";
import { ProjectIcon } from "./ProjectChip.tsx";
import { usePlanner } from "./plannerContext.ts";
import { pointBelow, type MenuPoint } from "./PointMenu.tsx";

/**
 * An automation in the Routines list, as a routine row: its name, project,
 * status, schedule with the next run and how many tasks it created. Drags to
 * reorder among automations; double-click or the arrow opens its window.
 */
export const AutomationRow = memo(function AutomationRow(props: {
  readonly automation: TaskAutomationListItem;
  readonly indicator: "above" | "below" | null;
  readonly onMenu: (automation: TaskAutomationListItem, point: MenuPoint) => void;
}) {
  const { automation } = props;
  const { windows, projectById } = usePlanner();
  const project = projectById.get(automation.projectId) ?? null;
  const {
    attributes,
    listeners,
    isDragging,
    setNodeRef: setDragNode,
  } = useDraggable({
    id: `automation-list-${automation.id}`,
    data: { type: "automation", automationId: automation.id },
  });
  const { setNodeRef: setDropNode } = useDroppable({
    id: `automation-list-${automation.id}`,
    data: { type: "automation-item", automationId: automation.id },
  });
  const setNode = useCallback(
    (node: HTMLElement | null) => {
      setDragNode(node);
      setDropNode(node);
    },
    [setDragNode, setDropNode],
  );
  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    props.onMenu(automation, { x: event.clientX, y: event.clientY });
  };
  const next =
    automation.status === "enabled" && automation.nextRunAt
      ? `next ${shortDateTime(automation.nextRunAt)}`
      : null;
  const count = automation.taskCount ?? null;
  return (
    <>
      {props.indicator === "above" ? <div className="mx-4 my-1 h-px bg-border" /> : null}
      <div
        ref={setNode}
        {...attributes}
        {...listeners}
        className={cn(
          "mx-2 flex min-w-0 cursor-grab items-start justify-between gap-2 rounded-xl px-3 py-3 transition-colors",
          isDragging ? "opacity-50" : "hover:bg-accent/60",
        )}
        data-automation-id={automation.id}
        onContextMenu={openMenu}
        onDoubleClick={() => windows.openAutomation(automation.id)}
      >
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "w-full whitespace-pre-wrap break-words text-sm font-medium text-foreground",
              automation.status !== "enabled" && "text-muted-foreground",
            )}
          >
            {automation.name}
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span
              role="img"
              className="flex shrink-0 items-center"
              aria-label={project?.name ?? "Unknown project"}
            >
              <ProjectIcon project={project} />
            </span>
            <TablePill>{AUTOMATION_STATUS_LABELS[automation.status]}</TablePill>
            <span className="min-w-0 truncate">
              {describeCron(automation.schedule.cron)}
              {next ? ` · ${next}` : ""}
            </span>
            {count !== null ? (
              <span className="shrink-0">{count === 1 ? "1 task" : `${count} tasks`}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconAction label="Open automation" onClick={() => windows.openAutomation(automation.id)}>
            <ChevronRightIcon />
          </IconAction>
          <IconAction
            label="More actions"
            onClick={(event) => props.onMenu(automation, pointBelow(event.currentTarget))}
          >
            <MoreVerticalIcon />
          </IconAction>
        </div>
      </div>
      {props.indicator === "below" ? <div className="mx-4 my-1 h-px bg-border" /> : null}
    </>
  );
});

export function AutomationDragPreview(props: { readonly automation: TaskAutomationListItem }) {
  return (
    <div className="w-64 rounded-xl border bg-card px-3 py-2 shadow-lg">
      <div className="truncate text-sm font-medium text-foreground">{props.automation.name}</div>
    </div>
  );
}
