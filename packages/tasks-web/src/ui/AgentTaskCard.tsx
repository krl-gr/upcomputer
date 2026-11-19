import { useRef, type ReactNode } from "react";
import { FolderIcon, InboxIcon } from "lucide-react";

import { ProjectFavicon } from "../../../../apps/web/src/components/ProjectFavicon.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { projectIconColorClassName } from "../../../../apps/web/src/projectIconColors.ts";
import {
  RunCountNumbers,
  runCountSummary,
} from "../../../../apps/web/src/sidebarThreadRow/runCountBadge.tsx";
import { isInboxRoot } from "../planner/ui/ProjectChip.tsx";
import {
  ROW_CLASS,
  ROW_DRAGGING_CLASS,
  ROW_HOVER_CLASS,
  ROW_TITLE_CLASS,
} from "../planner/ui/rowShell.ts";
import type { ScopedTaskListItem } from "../state/taskPages.ts";
import type { TasksWebProject } from "./shared.ts";
import { groupTaskRunCounts } from "./taskRunPresentation.ts";

/** The controls' height: the xs button and select are 28px, and 24px from the `sm` breakpoint. */
const TILE_SIZE = "size-7 sm:size-6";

/**
 * The project as the card's leading icon, as tall as the controls on the
 * right. A monogram or favicon fills the tile; an icon sits in a tinted one.
 * It is not a control: the project changes in the task's details.
 */
function ProjectTile(props: {
  readonly project: TasksWebProject | null;
  readonly name: string | null;
}) {
  const favicon = props.project?.favicon ?? null;
  const inbox = props.project !== null && isInboxRoot(props.project.workspaceRoot);
  const label = inbox ? "Inbox" : (props.name ?? props.project?.name ?? "Unknown project");
  const icon = favicon?.projectIcon;
  const frame = cn("grid place-items-center rounded-md", TILE_SIZE);
  let tile: ReactNode;
  if (favicon === null || inbox) {
    tile = (
      <span className={cn(frame, "bg-foreground/8 text-muted-foreground")}>
        {inbox ? <InboxIcon className="size-4" /> : <FolderIcon className="size-4" />}
      </span>
    );
  } else if (icon?.kind === "lucide") {
    tile = (
      <span
        className={cn(frame, projectIconColorClassName(icon.color))}
        style={{ backgroundColor: "color-mix(in srgb, currentColor 14%, transparent)" }}
      >
        <ProjectFavicon project={favicon} className="size-4" />
      </span>
    );
  } else if (icon?.kind === "emoji") {
    tile = (
      <span className={cn(frame, "bg-foreground/8")}>
        <ProjectFavicon project={favicon} className="size-4" />
      </span>
    );
  } else {
    tile = <ProjectFavicon project={favicon} className={TILE_SIZE} />;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className={cn("flex self-center", TILE_SIZE)}
            data-project-tile=""
          />
        }
      >
        {tile}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * An agent task in the narrow list, laid out like a notification card: the
 * project's icon, the title with its tags under it as a line of plain muted
 * text, and on the right the run counts and the status select. The icon and
 * the controls are level with the card's middle at every width.
 */
export function AgentTaskCard(props: {
  readonly task: ScopedTaskListItem;
  readonly project: TasksWebProject | null;
  readonly statuses: readonly string[];
  readonly canMutate: boolean;
  readonly dragged: boolean;
  /** The whole card drags into the list order, as a planner row does; its controls do not start a drag. */
  readonly reorderable: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onOpen: () => void;
  readonly onStatusChange: (status: string) => void;
  readonly onDrop: () => void;
}) {
  const { task } = props;
  const runs = groupTaskRunCounts(task.runCounts);
  const archived = task.archivedAt !== null;
  const dragFromControl = useRef(false);
  return (
    <div
      className={cn(
        ROW_CLASS,
        "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5",
        props.dragged ? ROW_DRAGGING_CLASS : ROW_HOVER_CLASS,
      )}
      data-task-card=""
      draggable={props.reorderable}
      onPointerDown={(event) => {
        dragFromControl.current = (event.target as Element).closest("[data-prevent-drag]") !== null;
      }}
      onDragStart={(event) => {
        if (dragFromControl.current) {
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
        // The controls act on their own; their menus are portaled, but their clicks bubble here.
        const target = event.target as Element;
        if (!event.currentTarget.contains(target) || target.closest("button,[role=combobox]"))
          return;
        props.onOpen();
      }}
    >
      <ProjectTile project={props.project} name={task.projectName} />
      <div className="min-w-0 self-center">
        <button
          type="button"
          className={cn(
            ROW_TITLE_CLASS,
            "block cursor-pointer text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
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
        {archived || task.tags.length > 0 ? (
          <Tooltip>
            {/* The notification card's detail line: one line of muted text, cut with an ellipsis. */}
            <TooltipTrigger
              render={<p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground" />}
              data-card-tags=""
            >
              {archived ? (task.tags.length > 0 ? "Archived · " : "Archived") : null}
              {task.tags.map((tag, index) => (
                <span key={tag} className={index > 0 ? "ms-1.5" : undefined}>
                  {tag}
                </span>
              ))}
            </TooltipTrigger>
            <TooltipPopup>
              {[...(archived ? ["Archived"] : []), ...task.tags].join(", ")}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex items-center gap-1 self-center" data-prevent-drag data-card-side="">
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
      </div>
    </div>
  );
}
