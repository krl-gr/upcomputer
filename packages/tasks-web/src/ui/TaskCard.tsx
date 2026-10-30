import { useRef } from "react";
import { MoreHorizontalIcon } from "lucide-react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../../../apps/web/src/components/ui/menu.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { ProjectChip, type PlannerProject } from "../planner/ui/ProjectChip.tsx";
import {
  ROW_CHIPS_CLASS,
  ROW_CLASS,
  ROW_DRAGGING_CLASS,
  ROW_HOVER_CLASS,
  ROW_LABEL_CHIP_CLASS,
  ROW_TITLE_CLASS,
} from "../planner/ui/rowShell.ts";
import type { ScopedTaskListItem } from "../state/taskPages.ts";
import { RunCountNumbers, runCountSummary } from "./RunCountNumbers.tsx";
import { groupTaskRunCounts } from "./taskRunPresentation.ts";

/**
 * An agent task in the narrow list, laid out like a planner row: the title,
 * then its project, status, tags, run counts and menu as chips. A click
 * outside the chips opens the task.
 */
export function TaskCard(props: {
  readonly task: ScopedTaskListItem;
  readonly projects: readonly PlannerProject[];
  readonly statuses: readonly string[];
  readonly canMutate: boolean;
  readonly dragged: boolean;
  /** The whole card drags into the list order, as a planner row does; chips do not start a drag. */
  readonly reorderable: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onOpen: () => void;
  readonly onProjectChange: (projectId: string) => void;
  readonly onStatusChange: (status: string) => void;
  readonly onArchivedChange: (archived: boolean) => void;
  readonly onDrop: () => void;
}) {
  const { task } = props;
  const runs = groupTaskRunCounts(task.runCounts);
  const archived = task.archivedAt !== null;
  const dragFromChip = useRef(false);
  return (
    <div
      className={cn(
        ROW_CLASS,
        "cursor-pointer",
        props.dragged ? ROW_DRAGGING_CLASS : ROW_HOVER_CLASS,
      )}
      data-task-card=""
      draggable={props.reorderable}
      onPointerDown={(event) => {
        dragFromChip.current = (event.target as Element).closest("[data-prevent-drag]") !== null;
      }}
      onDragStart={(event) => {
        if (dragFromChip.current) {
          event.preventDefault();
          return;
        }
        props.onDragStart();
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop();
      }}
      onClick={(event) => {
        // Chips act on their own; their menus are portaled, but their clicks bubble here.
        const target = event.target as Element;
        if (!event.currentTarget.contains(target) || target.closest("button,[role=combobox]"))
          return;
        props.onOpen();
      }}
    >
      <button
        type="button"
        className={cn(
          ROW_TITLE_CLASS,
          "block text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-keyshortcuts={props.reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        onClick={props.onOpen}
        onKeyDown={(event) => {
          if (!props.reorderable || !event.altKey) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          props.onMove(event.key === "ArrowUp" ? "up" : "down");
        }}
      >
        <span className="line-clamp-2">{task.title}</span>
      </button>
      <div className={ROW_CHIPS_CLASS} data-prevent-drag>
        <ProjectChip
          projects={props.projects}
          value={task.projectId}
          disabled={!props.canMutate}
          onChange={(projectId) => {
            if (projectId) props.onProjectChange(projectId);
          }}
        />
        <Select
          value={task.status}
          disabled={!props.canMutate}
          onValueChange={(status) => {
            if (status && status !== task.status) props.onStatusChange(status);
          }}
        >
          <SelectTrigger size="xs" className="w-auto min-w-0 max-w-48" aria-label="Task status">
            <SelectValue>
              <span className="truncate">{task.status}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {props.statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {archived ? <span className={ROW_LABEL_CHIP_CLASS}>Archived</span> : null}
        {task.tags.map((tag) => (
          <span key={tag} className={ROW_LABEL_CHIP_CLASS}>
            <span className="truncate"># {tag}</span>
          </span>
        ))}
        {runs.length > 0 ? (
          <Button
            variant="outline"
            size="xs"
            aria-label={`Runs: ${runCountSummary(runs)}`}
            onClick={props.onOpen}
          >
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <RunCountNumbers groups={runs} />
            </span>
          </Button>
        ) : null}
        {props.canMutate ? (
          <Menu>
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="More actions" />}
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => props.onArchivedChange(!archived)}>
                {archived ? "Unarchive" : "Archive"}
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
    </div>
  );
}
