import { useRef, type ReactNode } from "react";
import { FolderIcon, InboxIcon } from "lucide-react";
import { useGT, useMessages } from "gt-react";

import { ProjectFavicon } from "../../../../apps/web/src/components/ProjectFavicon.tsx";
import { setComposerTaskDragData } from "../../../../apps/web/src/components/chat/composerTaskDrag.ts";
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
import "./agentTaskCard.css";

/** The tile's height: the xs runs button's, 28px, and 24px from the `sm` breakpoint. */
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
  const gt = useGT();
  const favicon = props.project?.favicon ?? null;
  const inbox = props.project !== null && isInboxRoot(props.project.workspaceRoot);
  const label = inbox ? gt("Inbox") : (props.name ?? props.project?.name ?? gt("Unknown project"));
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

/** Gives the card its status select's width, which the title fades out under on hover. */
function measureStatusWidth(status: HTMLDivElement | null) {
  const card = status?.parentElement;
  if (!status || !card || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => {
    card.style.setProperty("--card-status-width", `${status.offsetWidth}px`);
  });
  observer.observe(status);
  return () => observer.disconnect();
}

/**
 * An agent task in the narrow list, laid out like a notification card: the
 * project's icon, the title over a line of tag chips, then the run counts and
 * the status select, shown on hover (`agentTaskCard.css`), level with its middle.
 */
export function AgentTaskCard(props: {
  readonly task: ScopedTaskListItem;
  readonly project: TasksWebProject | null;
  /** Off when the list shows one project: the card then starts with its title. */
  readonly showProject?: boolean;
  readonly statuses: readonly string[];
  readonly canMutate: boolean;
  readonly dragged: boolean;
  /** The whole card drags into the list order, as a planner row does; its controls do not start a drag. */
  readonly reorderable: boolean;
  /** Allows dragging the card into a chat composer as a quote even when reordering is disabled. */
  readonly quoteDraggable?: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onOpen: () => void;
  readonly onStatusChange: (status: string) => void;
  readonly onDrop: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const archivedLabel = gt("Archived", { $context: "status of an archived task" });
  const { task } = props;
  const runs = groupTaskRunCounts(task.runCounts);
  const archived = task.archivedAt !== null;
  const dragFromControl = useRef(false);
  return (
    <div
      className={cn(
        ROW_CLASS,
        // The runs and the status flow into columns after the title's.
        "grid cursor-pointer grid-flow-col grid-rows-[auto] auto-cols-auto items-start gap-x-2.5",
        props.showProject === false
          ? "grid-cols-[minmax(0,1fr)]"
          : "grid-cols-[auto_minmax(0,1fr)]",
        props.dragged ? ROW_DRAGGING_CLASS : ROW_HOVER_CLASS,
      )}
      data-task-card=""
      draggable={props.reorderable || props.quoteDraggable === true}
      onPointerDown={(event) => {
        dragFromControl.current = (event.target as Element).closest("[data-prevent-drag]") !== null;
      }}
      onDragStart={(event) => {
        if (dragFromControl.current) {
          event.preventDefault();
          return;
        }
        setComposerTaskDragData(event.dataTransfer, {
          environmentId: task.environmentId,
          taskId: task.id,
          title: task.title,
          kind: task.kind,
        });
        if (props.reorderable) props.onDragStart();
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        if (props.reorderable) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!props.reorderable) return;
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
      {props.showProject === false ? null : (
        <ProjectTile project={props.project} name={task.projectName} />
      )}
      <div className="col-[-2/-1] row-start-1 min-w-0 self-center" data-card-content="">
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
              {archived ? (task.tags.length > 0 ? `${archivedLabel} · ` : archivedLabel) : null}
              {task.tags.map((tag, index) => (
                <span
                  key={tag}
                  className={cn(
                    "inline-block rounded-sm bg-foreground/6 px-1 align-top",
                    index > 0 && "ms-1",
                  )}
                >
                  {tag}
                </span>
              ))}
            </TooltipTrigger>
            <TooltipPopup>
              {[...(archived ? [archivedLabel] : []), ...task.tags].join(", ")}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {runs.length > 0 ? (
        <div className="flex items-center self-center" data-prevent-drag data-card-side="">
          <Button
            variant="outline"
            size="xs"
            aria-label={gt("Runs: {summary}", { summary: runCountSummary(runs, m) })}
            onClick={props.onOpen}
          >
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <RunCountNumbers groups={runs} />
            </span>
          </Button>
        </div>
      ) : null}
      <div
        ref={measureStatusWidth}
        className="flex min-w-0 items-center self-center"
        data-prevent-drag
        data-card-status=""
      >
        <Select
          value={task.status}
          disabled={!props.canMutate}
          onValueChange={(status) => {
            if (status && status !== task.status) props.onStatusChange(status);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-auto min-w-0 max-w-48"
            aria-label={gt("Task status")}
          >
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
