/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeftIcon, GripVerticalIcon } from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import {
  AGENT_RESTORED_STATUS,
  DEFAULT_TASK_STATUS,
  sameTaskStatus,
  TASK_HISTORY_EVENT_KINDS,
  TASK_STATUSES,
  TaskId,
  type TaskArchiveFilter,
  type TaskAudience,
  type TaskEvent,
} from "@t3tools/tasks-contracts/v1";
import { taskRunPresentation, groupTaskRunCounts, runSearchStatus } from "./taskRunPresentation.ts";
import type { ScopedTaskListItem } from "../state/taskPages.ts";
import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import type { TasksWebRpcClient } from "../rpc/index.ts";
import type { ScopedTask, ScopedTaskAgent, ScopedTaskAgentRun } from "../state/index.ts";
import { stackedThreadToast, toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { ProjectFavicon } from "../../../../apps/web/src/components/ProjectFavicon.tsx";
import { TaskOutput } from "./TaskOutput.tsx";
import { openFileInWorkerThread } from "./TaskFileWindow.tsx";
import type { ProviderInstanceEntry } from "../../../../apps/web/src/providerInstances.ts";
import { TaskThreadLink } from "./TaskThreadLink.tsx";
import { getTaskRunAgentPresentation } from "./agentModelOptions.ts";
import { persistPlannedTaskMove, planVisibleTaskMove } from "./taskReorder.ts";
import {
  DETAIL_INPUT_CLASS,
  DETAIL_SELECT_TRIGGER_CLASS,
  DetailColumn,
  DetailSidebarRow,
  DetailSidebarSection,
} from "./DetailSidebar.tsx";
import { toastAudienceMoved } from "../planner/ui/audienceMoved.ts";
import { WorkspaceViewLayout } from "./WorkspaceViewLayout.tsx";
import { FLOATING_ACTIONS_CLEARANCE_CLASS } from "./FloatingActions.tsx";
import { SHOW_MANUAL_CREATE_ACTIONS } from "./manualCreation.ts";
import {
  orderedProjectFilterKeys,
  preferredProject,
  type ViewProjectFilter,
} from "./projectFilter.ts";
import {
  agentTriggerTags,
  ALL_FILTER,
  matchesLastRunFilter,
  type TasksPageFilters,
} from "./pageFilters.ts";
import { ProjectIconCell, ProjectIconHeader } from "./ProjectIconCell.tsx";
import { AgentTaskCard } from "./AgentTaskCard.tsx";
import { TaskFilterRow, TaskFiltersButton } from "./TaskFilters.tsx";
import {
  TaskGroupShowMore,
  TaskStatusCardGroup,
  TaskStatusGroupsProvider,
  TaskStatusTableGroup,
} from "./TaskStatusGroups.tsx";
import {
  mergedGroupOrder,
  sameStatusGroup,
  statusGroupKey,
  taskStatusGroups,
  tasksOfGroup,
  type TaskStatusGroup,
} from "./taskStatusGroups.ts";
import type { TasksViewGrouping } from "./useTaskList.ts";
import { taskListLayout, type TaskListLayout } from "./taskListLayout.ts";
import { LIST_CLASS, LIST_SCROLL_CLASS } from "../planner/ui/rowShell.ts";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { observeResize } from "../../../../apps/web/src/lib/observeResize.ts";
import { useMediaQuery } from "../../../../apps/web/src/hooks/useMediaQuery.ts";
import { TableRunCounts } from "./RunCountNumbers.tsx";
import { TaskHistory, taskHistoryEntries } from "./TaskHistory.tsx";
import { TaskTagChips } from "./TaskTagChips.tsx";
import { TagChipsField } from "./TagChipsField.tsx";
import { tagSuggestions } from "./tagSuggestions.ts";
import { LazyMarkdownEditor } from "../markdown/LazyMarkdownEditor.tsx";
import {
  splitListInput,
  taskKey,
  taskMetadataLabel,
  uniqueStatuses,
  type TasksWebProject,
} from "./shared.ts";
import { pickerProjectFor, pickerProjects, sameProjectGroup } from "./taskProjects.ts";
import { ListEmptyState } from "./ListEmptyState.tsx";
import { useTaskArrivals } from "./taskArrivals.ts";
import "./taskArrival.css";
import { plainErrorSentence } from "@t3tools/client-runtime/errors";
import { useComputerName } from "../../../../apps/web/src/sidebarComputers/useSidebarComputers.ts";

/** Rows a status group shows at first, and how many more each "Show more" adds. */
const GROUP_FIRST_ROWS = 20;
const GROUP_MORE_ROWS = 50;
const LIST_ONLY: ReadonlySet<string> = new Set([""]);

/** The canonical statuses in workflow order, with Restore's status next to To Do. */
const STATUS_ORDER = TASK_STATUSES.flatMap((status) =>
  status === DEFAULT_TASK_STATUS ? [status, AGENT_RESTORED_STATUS] : [status],
);

type InlineTaskUpdate = Partial<
  Pick<ScopedTask, "title" | "description" | "status" | "tags" | "audience" | "projectId">
>;

interface TaskFormState {
  readonly title: string;
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | "";
  readonly status: string;
  readonly tags: string;
  readonly description: string;
}

/** Who does a task, in its details: changing it moves the task between Agents and Me. */
const AUDIENCE_LABELS: Record<TaskAudience, string> = {
  agent: msg("Workers"),
  person: msg("Me", { $context: "the person themselves, as who does a task" }),
};
const TASKS_OFFLINE_TEXT = msg(
  "The environment with Tasks is not reachable right now. Tasks show when it connects.",
);
const TABLE_CLASS = "w-full min-w-[920px] border-collapse text-left text-sm";
const OFFLINE_NOTE_CLASS =
  "rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground";

function OfflineComputerNote(props: {
  readonly environmentId: EnvironmentId;
  readonly showsRows: boolean;
}) {
  const gt = useGT();
  const name = useComputerName(props.environmentId);
  return (
    <div className={OFFLINE_NOTE_CLASS}>
      {props.showsRows
        ? name
          ? gt("{name} is not connected. Its tasks may be out of date.", { name })
          : gt("A computer is not connected. Its tasks may be out of date.")
        : name
          ? gt("Tasks from {name} will show when it reconnects.", { name })
          : gt("Tasks from a computer that is not connected will show when it reconnects.")}
    </div>
  );
}

export interface TasksViewProps {
  readonly projects: readonly TasksWebProject[];
  readonly tasks: readonly ScopedTaskListItem[];
  readonly statuses: readonly string[];
  /** The header's shared project choice; null is All projects. */
  readonly projectFilter: ViewProjectFilter | null;
  /** The shared project select: at the right of the wide header, in the narrow one's filters. */
  readonly projectSelect?: ReactNode;
  /** Sets the shared project choice back to All projects, for the filters' Reset. */
  readonly onProjectFilterReset?: () => void;
  /** The Me / Workers switch and the Tasks / Automations switch, at the left of the header. */
  readonly viewSwitch?: ReactNode;
  /** Task status, last run, tags (all required) and archive, all applied by the server. */
  readonly filters: TasksPageFilters;
  readonly onFiltersChange: (filters: TasksPageFilters) => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  /** Grouping by status; without it the list is never grouped. */
  readonly grouping?: TasksViewGrouping;
  readonly agents: readonly ScopedTaskAgent[];
  readonly runs: readonly ScopedTaskAgentRun[];
  /** Resolves run harness and model display names. */
  readonly providerEntriesByEnvironment: ReadonlyMap<
    EnvironmentId,
    readonly ProviderInstanceEntry[]
  >;
  readonly status: "loading" | "ready" | "error" | "offline";
  readonly errorMessage?: string;
  /** Environments that are not connected while others answered: each gets a quiet note. */
  readonly offlineEnvironmentIds?: readonly EnvironmentId[];
  readonly initialSelectedTaskKey?: string;
  readonly canMutateEnvironment: (environmentId: EnvironmentId) => boolean;
  readonly getClient: (environmentId: EnvironmentId) => TasksWebRpcClient | null;
  readonly onReload: () => void;
  readonly onNavigateBack: () => void;
  readonly onSelectedTaskKeyChange?: (taskKey: string | null) => void;
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  /** Opens a task's window in the planner, where a task taken back from agents goes. */
  readonly onOpenInPlanner?: (environmentId: EnvironmentId, taskId: string) => void;
  /** `panel` fits a right-panel surface: cards, filters behind a button, stacked details. */
  readonly layout?: "page" | "panel";
  /** The panel's Worker tasks entry: no list header, the filter and + float over the list. */
  readonly floatingControls?: boolean;
  /** The thread beside a right-panel surface, whose panel opens the output's file links. */
  readonly filePanelRef?: ScopedThreadRef;
}

function emptyForm(project?: TasksWebProject): TaskFormState {
  return {
    title: "",
    environmentId: project?.environmentId ?? null,
    projectId: project?.id ?? "",
    status: DEFAULT_TASK_STATUS,
    tags: "",
    description: "",
  };
}

function projectKey(project: Pick<TasksWebProject, "environmentId" | "id">): string {
  return `${project.environmentId}:${project.id}`;
}

function taskProjectKey(task: Pick<ScopedTask, "environmentId" | "projectId">): string {
  return `${task.environmentId}:${task.projectId}`;
}

function selectedProjectKey(form: TaskFormState): string {
  return form.environmentId ? `${form.environmentId}:${form.projectId}` : "";
}

function errorDescription(error: unknown): string {
  return plainErrorSentence(error);
}

const DESCRIPTION_EDITOR_CLASS =
  "min-h-36 w-full flex-1 px-3 py-2 text-lg leading-8 text-foreground";

/**
 * A task's description in the table detail, saved when the field loses focus.
 * The edit stays shown until the saved (or an agent's newer) text arrives.
 */
function DetailDescriptionEditor(props: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onSave: (description: string) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState<{ readonly base: string; readonly text: string }>();
  const text = draft?.base === props.value ? draft.text : undefined;
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  });
  return (
    <LazyMarkdownEditor
      value={text ?? props.value}
      disabled={props.disabled}
      placeholder={gt("Description…")}
      ariaLabel={gt("Task description")}
      className={DESCRIPTION_EDITOR_CLASS}
      onChange={(next) => {
        textRef.current = next;
        setDraft({ base: props.value, text: next });
      }}
      onBlur={() => {
        const description = textRef.current?.trim();
        if (description !== undefined && description !== props.value) props.onSave(description);
      }}
    />
  );
}

function shortTaskId(id: string): string {
  const displayId = id.startsWith("task-") ? id.slice("task-".length) : id;
  return displayId.length > 8 ? `${displayId.slice(0, 8)}…` : displayId;
}

function compareStatuses(left: string, right: string): number {
  const leftIndex = STATUS_ORDER.findIndex((status) => sameTaskStatus(status, left));
  const rightIndex = STATUS_ORDER.findIndex((status) => sameTaskStatus(status, right));
  if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return leftIndex - rightIndex;
}

export function TaskReorderHandle(props: {
  readonly task: ScopedTask;
  /** Translated by the caller, which has `useGT()`. */
  readonly ariaLabel: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onMove: (direction: "up" | "down") => void;
}) {
  return (
    <button
      type="button"
      draggable={props.enabled}
      disabled={!props.enabled}
      className="cursor-grab rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={props.ariaLabel}
      title={props.title}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.stopPropagation();
        props.onDragStart();
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={props.onDragEnd}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        props.onMove(event.key === "ArrowUp" ? "up" : "down");
      }}
    >
      <GripVerticalIcon className="size-4" aria-hidden="true" />
    </button>
  );
}

export function TasksView(props: TasksViewProps) {
  const gt = useGT();
  const m = useMessages();
  const [createModeOpen, setCreateModeOpen] = useState(false);
  const [detailRuns, setDetailRuns] = useState<readonly ScopedTaskAgentRun[]>([]);
  const [detailRunsStatus, setDetailRunsStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const detailRequestRef = useRef(0);
  const detailBusyRef = useRef(false);
  const pendingDetailRefresh = useRef<(() => void) | null>(null);
  const detailPagesRef = useRef(1);
  const [runFilter, setRunFilter] = useState(ALL_FILTER);
  const [activeRuns, setActiveRuns] = useState<readonly ScopedTaskAgentRun[]>([]);
  const [moreRuns, setMoreRuns] = useState(false);
  const [fetchedTask, setFetchedTask] = useState<ScopedTask | null>(null);
  /** English from `msg()`, shown through `useMessages()`. */
  const [detailError, setDetailError] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(() => emptyForm(props.projects[0]));
  const [saving, setSaving] = useState(false);
  const createInFlightRef = useRef(false);
  const [updatingField, setUpdatingField] = useState<string | null>(null);
  const { projectFilter, filters, onFiltersChange } = props;
  const panel = props.layout === "panel";
  // A window too narrow for two columns stacks the details under the output, as the panel does.
  const stackedDetail = useMediaQuery({ max: 900 }) || panel;
  // The list's own width picks table or cards; the first measurement lands before paint.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  // Before the list is measured the page shows the table; the right panel always shows cards.
  const [listLayout, setListLayout] = useState<TaskListLayout>("table");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the list element's DOM width
  useLayoutEffect(() => {
    if (!listElement) return;
    const measure = (width: number) => setListLayout((shown) => taskListLayout(width, shown));
    measure(listElement.getBoundingClientRect().width);
    return observeResize(listElement, (entries) => {
      const entry = entries.at(-1);
      if (entry) measure(entry.contentRect.width);
    });
  }, [listElement]);
  const cards = panel || listLayout === "cards";
  const statusFilter = filters.status;
  const archiveFilter: TaskArchiveFilter = filters.archive ?? "active";
  const [history, setHistory] = useState<{
    readonly taskKey: string | null;
    readonly events: readonly TaskEvent[];
    readonly status: "loading" | "ready" | "error";
  }>({ taskKey: null, events: [], status: "loading" });
  const [optimisticTasks, setOptimisticTasks] = useState<readonly ScopedTaskListItem[]>(
    props.tasks,
  );
  const [draggedTaskKey, setDraggedTaskKey] = useState<string | null>(null);
  const reorderInFlightRef = useRef(false);
  useEffect(() => {
    if (!reorderInFlightRef.current) setOptimisticTasks(props.tasks);
  }, [props.tasks]);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(
    props.initialSelectedTaskKey ?? null,
  );
  useEffect(() => {
    setSelectedTaskKey(props.initialSelectedTaskKey ?? null);
    if (props.initialSelectedTaskKey) setCreateModeOpen(false);
  }, [props.initialSelectedTaskKey]);
  const selectTaskKey = useCallback(
    (taskKey: string | null) => {
      setSelectedTaskKey(taskKey);
      props.onSelectedTaskKeyChange?.(taskKey);
    },
    [props.onSelectedTaskKeyChange],
  );
  const selectedProject = props.projects.find(
    (project) => projectKey(project) === selectedProjectKey(form),
  );
  const selectedTask = selectedTaskKey
    ? ((fetchedTask && taskKey(fetchedTask) === selectedTaskKey ? fetchedTask : null) ??
      props.tasks.find((task) => taskKey(task) === selectedTaskKey) ??
      null)
    : null;
  const hasSelectedTaskOutput = Boolean(selectedTask?.output?.trim());
  const projectsByKey = useMemo(
    () => new Map(props.projects.map((project) => [projectKey(project), project] as const)),
    [props.projects],
  );
  const selectedTaskProject = selectedTask
    ? (projectsByKey.get(taskProjectKey(selectedTask)) ?? null)
    : null;
  // The details' project picker lists the task's environment, one entry per sidebar group.
  const selectedTaskEnvironmentProjects = useMemo(
    () =>
      pickerProjects(
        props.projects.filter((project) => project.environmentId === selectedTask?.environmentId),
      ),
    [props.projects, selectedTask?.environmentId],
  );
  const taskThreads = detailRuns;
  // Active runs come unfiltered; the history can be filtered by status.
  const latestRun = [...activeRuns, ...detailRuns].reduce<ScopedTaskAgentRun | undefined>(
    (latest, run) => (latest === undefined || run.startedAt > latest.startedAt ? run : latest),
    undefined,
  );
  const mutableProjects = props.projects.filter((project) =>
    props.canMutateEnvironment(project.environmentId),
  );
  const hasReadOnlyProjects = mutableProjects.length < props.projects.length;
  const projectOptions = useMemo(() => pickerProjects(mutableProjects), [mutableProjects]);
  const selectedProjectOption = useMemo(
    () => (selectedProject ? pickerProjectFor(projectOptions, selectedProject) : undefined),
    [projectOptions, selectedProject],
  );
  const statusOptions = useMemo(
    () =>
      uniqueStatuses([
        ...props.statuses,
        ...(statusFilter === ALL_FILTER ? [] : [statusFilter]),
        ...(selectedTask ? [selectedTask.status] : []),
      ]).sort(compareStatuses),
    [props.statuses, selectedTask, statusFilter],
  );
  // The server applies the last-run filter; an older one does not, so the loaded rows are checked too.
  const filteredTasks = useMemo(
    () => optimisticTasks.filter((task) => matchesLastRunFilter(task, filters.lastRun)),
    [filters.lastRun, optimisticTasks],
  );
  const grouping = props.grouping;
  const grouped = grouping?.settings.groupByStatus ?? false;
  const { groups, order: groupOrder } = useMemo(
    () =>
      taskStatusGroups({
        tasks: grouped ? filteredTasks : [],
        counts: grouping?.counts ?? new Map(),
        statuses: props.statuses,
        statusFilter: statusFilter === ALL_FILTER ? null : statusFilter,
        order: grouping?.settings.statusGroupOrder ?? [],
        open: grouping?.settings.statusGroupOpen ?? {},
      }),
    [filteredTasks, grouped, grouping, props.statuses, statusFilter],
  );
  // Open groups whose rows are loaded: only a task that shows up in one of these is new.
  const readyGroups = useMemo(
    () =>
      grouped
        ? new Set(
            groups
              .filter((group) => group.open && grouping?.paging.get(group.key)?.loading !== true)
              .map((group) => group.key),
          )
        : LIST_ONLY,
    [grouped, grouping?.paging, groups],
  );
  // The loaded rows, not the optimistic copy, which trails a page by a render.
  const { arrivals, settle: settleArrivals } = useTaskArrivals(
    props.tasks.map((task) => ({
      key: taskKey(task),
      group: grouped ? statusGroupKey(task.status) : "",
    })),
    // A computer going offline or coming back resets the baseline, so its rows don't replay as new.
    JSON.stringify([
      projectFilter?.key ?? null,
      filters,
      props.offlineEnvironmentIds ?? [],
      grouped,
    ]),
    props.status === "ready",
    props.loadingMore,
    readyGroups,
  );
  const triggerTags = useMemo(() => agentTriggerTags(props.agents), [props.agents]);
  const tagOptions = useMemo(
    () =>
      [
        ...new Set([...props.tasks.flatMap((task) => task.tags), ...triggerTags, ...filters.tags]),
      ].sort((left, right) => left.localeCompare(right)),
    [filters.tags, props.tasks, triggerTags],
  );
  // Hide what the filter already says: the project with one project chosen, and the
  // status in a list grouped by status (a card keeps its status select, which changes it).
  const showProjectColumn = projectFilter === null;
  const showStatusColumn = !grouped;
  const environmentCount = new Set(props.tasks.map(({ environmentId }) => environmentId)).size;

  const [groupRowLimits, setGroupRowLimits] = useState<Readonly<Record<string, number>>>({});

  const persistVisibleMove = useCallback(
    async (task: ScopedTaskListItem, directionOrTarget: "up" | "down" | ScopedTaskListItem) => {
      if (reorderInFlightRef.current || !props.canMutateEnvironment(task.environmentId)) return;
      const result = planVisibleTaskMove({
        tasks: optimisticTasks,
        // In a grouped list a task moves among its own group's shown tasks only.
        visibleTasks: grouped
          ? tasksOfGroup(filteredTasks, task.status).slice(
              0,
              groupRowLimits[statusGroupKey(task.status)] ?? GROUP_FIRST_ROWS,
            )
          : filteredTasks,
        task,
        directionOrTarget,
      });
      if (!result.ok) {
        if (result.reason === "cross-environment") {
          toastManager.add({
            type: "error",
            title: gt("Tasks can only be reordered within one environment"),
          });
        }
        return;
      }

      const previous = optimisticTasks;
      reorderInFlightRef.current = true;
      try {
        const client = props.getClient(task.environmentId);
        if (!client) throw new Error(gt("The computer with your tasks isn't connected."));
        await persistPlannedTaskMove({
          previousTasks: previous,
          plan: result.plan,
          setTasks: setOptimisticTasks,
          reorder: (request) => client.tasks.reorder(request),
          onReload: props.onReload,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Couldn't move the task"),
            description: errorDescription(error),
          }),
        );
      } finally {
        reorderInFlightRef.current = false;
      }
    },
    [filteredTasks, gt, grouped, groupRowLimits, optimisticTasks, props],
  );

  const dropOn = (task: ScopedTaskListItem) => {
    const dragged = optimisticTasks.find((candidate) => taskKey(candidate) === draggedTaskKey);
    setDraggedTaskKey(null);
    if (!dragged || taskKey(dragged) === taskKey(task)) return;
    // A task's status changes only through its status picker, never by a drop on another group.
    if (grouped && !sameStatusGroup(dragged.status, task.status)) return;
    void persistVisibleMove(dragged, task);
  };
  const reorderHandle = (task: ScopedTaskListItem) => (
    <TaskReorderHandle
      task={task}
      ariaLabel={gt("Reorder {title}", { title: task.title })}
      title={gt(
        "Drag to reorder globally. Worker queues run from the bottom, so lower runs sooner. With filters, the task is placed between the visible neighbors; hidden tasks keep their order.",
      )}
      enabled={props.canMutateEnvironment(task.environmentId)}
      onDragStart={() => setDraggedTaskKey(taskKey(task))}
      onDragEnd={() => setDraggedTaskKey(null)}
      onMove={(direction) => {
        void persistVisibleMove(task, direction);
      }}
    />
  );

  const openCreate = useCallback(() => {
    detailRequestRef.current += 1;
    setDetailRuns([]);
    setDetailRunsStatus("idle");
    selectTaskKey(null);
    // Preselect the filtered project (its members, in the sidebar's order).
    setForm(emptyForm(preferredProject(projectOptions, orderedProjectFilterKeys(projectFilter))));
    setCreateModeOpen(true);
  }, [projectOptions, projectFilter, selectTaskKey]);

  // Details subscribe to their own task, including deep links outside loaded pages.
  useEffect(() => {
    if (!selectedTaskKey) return;
    let cancelled = false;
    let request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const separator = selectedTaskKey.indexOf(":");
    const environmentId = selectedTaskKey.slice(0, separator) as EnvironmentId;
    const id = selectedTaskKey.slice(separator + 1);
    const client = props.getClient(environmentId);
    if (!client || separator < 1 || !id.trim()) {
      setDetailError(msg("Couldn't open this task: the computer with your tasks isn't connected."));
      return;
    }
    const refresh = () => {
      const current = ++request;
      void client.tasks.get({ id: TaskId.make(id) }).then(
        (task) => {
          if (cancelled || request !== current) return;
          if (!task) {
            setFetchedTask(null);
            setDetailError(msg("Task not found."));
            return;
          }
          setDetailError(null);
          setFetchedTask({
            ...task,
            environmentId,
            projectName:
              props.projects.find(
                (project) =>
                  project.environmentId === environmentId && project.id === task.projectId,
              )?.name ?? null,
          });
        },
        () => {
          if (!cancelled && request === current) setDetailError(msg("Could not refresh task."));
        },
      );
    };
    const unsubscribe = client.tasks.subscribe(
      (event) => {
        if (event.kind !== "sync" && !event.taskIds.includes(TaskId.make(id))) return;
        clearTimeout(timer);
        timer = setTimeout(refresh, 150);
      },
      () => {
        if (!cancelled) setDetailError(msg("Task updates are temporarily unavailable."));
      },
    );
    const foreground = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [selectedTaskKey, props.getClient, props.projects]);

  const loadTaskRuns = useCallback(
    (task: ScopedTask, append = false, background = false) => {
      const requestId = ++detailRequestRef.current;
      if (!background) setDetailRunsStatus("loading");
      const client = props.getClient(task.environmentId);
      if (!client) {
        setDetailRunsStatus("error");
        return;
      }
      const last = append ? detailRuns.at(-1) : undefined;
      detailBusyRef.current = true;
      const finished = () => {
        detailBusyRef.current = false;
        const refresh = pendingDetailRefresh.current;
        pendingDetailRefresh.current = null;
        if (refresh) queueMicrotask(refresh);
      };
      const fetchHistory = async () => {
        const runs: ScopedTaskAgentRun[] = [];
        let cursor = last ? { startedAt: last.startedAt, id: last.id } : undefined;
        let hasMore = false;
        const pages = append ? 1 : detailPagesRef.current;
        for (let index = 0; index < pages; index += 1) {
          const result = await client.agents.searchRuns({
            taskId: task.id,
            limit: 100,
            ...(runFilter === ALL_FILTER ? {} : { status: runSearchStatus(runFilter) }),
            ...(cursor ? { cursor } : {}),
          });
          if (detailRequestRef.current !== requestId) break;
          runs.push(...result.runs.map((run) => ({ ...run, environmentId: task.environmentId })));
          hasMore = result.runs.length === 100;
          const tail = result.runs.at(-1);
          if (!hasMore || !tail) break;
          cursor = { startedAt: tail.startedAt, id: tail.id };
        }
        return { runs, hasMore };
      };
      const fetchActive = async () => {
        const runs: ScopedTaskAgentRun[] = [];
        let cursor: { startedAt: string; id: ScopedTaskAgentRun["id"] } | undefined;
        while (detailRequestRef.current === requestId) {
          const result = await client.agents.searchRuns({
            taskId: task.id,
            activeOnly: true,
            limit: 500,
            ...(cursor ? { cursor } : {}),
          });
          runs.push(...result.runs.map((run) => ({ ...run, environmentId: task.environmentId })));
          const tail = result.runs.at(-1);
          if (result.runs.length < 500 || !tail) break;
          cursor = { startedAt: tail.startedAt, id: tail.id };
        }
        return { runs };
      };
      void Promise.all([fetchHistory(), fetchActive()]).then(
        ([result, active]) => {
          if (detailRequestRef.current !== requestId) return;
          const scoped = result.runs.map((run) => ({ ...run, environmentId: task.environmentId }));
          setDetailRuns((previous) => [
            ...new Map(
              (append ? [...previous, ...scoped] : scoped).map((run) => [run.id, run]),
            ).values(),
          ]);
          setActiveRuns(active.runs.map((run) => ({ ...run, environmentId: task.environmentId })));
          setMoreRuns(result.hasMore);
          if (append) detailPagesRef.current += 1;
          finished();
          setDetailRunsStatus("ready");
        },
        () => {
          if (detailRequestRef.current === requestId) {
            finished();
            setDetailRunsStatus("error");
          }
        },
      );
    },
    [props.getClient, runFilter, detailRuns],
  );
  const loadTaskRunsRef = useRef(loadTaskRuns);
  loadTaskRunsRef.current = loadTaskRuns;

  const openTask = useCallback(
    (task: ScopedTask, status = ALL_FILTER) => {
      setFetchedTask(task);
      setRunFilter(status);
      selectTaskKey(taskKey(task));
    },
    [selectTaskKey],
  );

  useEffect(() => {
    setDetailRuns([]);
    setActiveRuns([]);
    setMoreRuns(false);
    detailPagesRef.current = 1;
    if (selectedTask) loadTaskRunsRef.current(selectedTask);
    return () => {
      detailRequestRef.current += 1;
    };
  }, [selectedTask?.id, selectedTask?.environmentId, runFilter]);

  useEffect(() => {
    if (!selectedTask) return;
    const client = props.getClient(selectedTask.environmentId);
    if (!client) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (disposed) return;
      if (detailBusyRef.current) {
        pendingDetailRefresh.current = refresh;
        return;
      }
      loadTaskRunsRef.current(selectedTask, false, true);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    const unsubscribe = client.tasks.subscribe(
      (event) => {
        if (event.kind === "sync" || (event.runsChanged && event.taskIds.includes(selectedTask.id)))
          schedule();
      },
      () => {
        if (!disposed) setDetailRunsStatus("error");
      },
    );
    const foreground = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (pendingDetailRefresh.current === refresh) pendingDetailRefresh.current = null;
      unsubscribe();
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [selectedTask?.id, selectedTask?.environmentId, props.getClient]);

  const updateTaskInline = useCallback(
    async (task: ScopedTask, field: string, update: InlineTaskUpdate): Promise<boolean> => {
      const client = props.getClient(task.environmentId);
      if (!client) return false;
      setUpdatingField(field);
      try {
        const updated = await client.tasks.update({ id: task.id, ...update });
        setFetchedTask({ ...task, ...updated });
        return true;
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Couldn't save the task"),
            description: errorDescription(error),
          }),
        );
        return false;
      } finally {
        setUpdatingField(null);
      }
    },
    [gt, props],
  );

  // Status and archive changes always touch updatedAt, so it keys the reload.
  useEffect(() => {
    if (!selectedTask) return;
    const client = props.getClient(selectedTask.environmentId);
    if (!client) return;
    const key = taskKey(selectedTask);
    let cancelled = false;
    void client.tasks
      .events({ taskId: selectedTask.id, kinds: [...TASK_HISTORY_EVENT_KINDS], limit: 50 })
      .then(
        ({ events }) => {
          if (!cancelled) setHistory({ taskKey: key, events, status: "ready" });
        },
        () => {
          if (!cancelled)
            setHistory((previous) => ({
              taskKey: key,
              events: previous.taskKey === key ? previous.events : [],
              status: "error",
            }));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.id, selectedTask?.environmentId, selectedTask?.updatedAt, props.getClient]);

  const historyEntries = useMemo(() => {
    if (!selectedTask || history.taskKey !== taskKey(selectedTask)) return [];
    const agentIdByRun = new Map(detailRuns.map((run) => [run.id as string, run.agentId]));
    const agentNames = new Map(props.agents.map((agent) => [agent.id as string, agent.name]));
    return taskHistoryEntries(
      history.events,
      (runId) => {
        const agentId = agentIdByRun.get(runId);
        return agentId === undefined ? null : (agentNames.get(agentId) ?? null);
      },
      gt,
    );
  }, [detailRuns, gt, history, props.agents, selectedTask]);

  const setTaskArchived = useCallback(
    async (task: ScopedTask, archived: boolean) => {
      const client = props.getClient(task.environmentId);
      if (!client) return;
      setUpdatingField("archive");
      try {
        await (archived ? client.tasks.archive : client.tasks.unarchive)({ ids: [task.id] });
        const fresh = await client.tasks.get({ id: task.id });
        if (fresh) setFetchedTask({ ...task, ...fresh });
        toastManager.add({
          type: "success",
          title: archived ? gt("Task archived") : gt("Task unarchived"),
          description: task.title,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: archived ? gt("Failed to archive task") : gt("Failed to unarchive task"),
            description: errorDescription(error),
          }),
        );
      } finally {
        setUpdatingField(null);
      }
    },
    [gt, props],
  );

  const save = useCallback(async () => {
    if (createInFlightRef.current) return;
    const title = form.title.trim();
    const status = form.status.trim();
    const target = selectedProject;
    if (!target || !title || !status) {
      toastManager.add({
        type: "error",
        title: !target
          ? gt("Select a project")
          : !title
            ? gt("Task title is required")
            : gt("Task status is required"),
      });
      return;
    }
    const client = props.getClient(target.environmentId);
    if (!client) {
      toastManager.add({
        type: "error",
        title: gt("Couldn't create the task"),
        description: gt("The computer with your tasks isn't connected. Reconnect, then try again."),
      });
      return;
    }
    createInFlightRef.current = true;
    setSaving(true);
    try {
      await client.tasks.create({
        projectId: target.id,
        title,
        description: form.description.trim(),
        status,
        tags: splitListInput(form.tags),
        // The table is the agents' side; the person's own tasks are made in the planner.
        audience: "agent",
      });
      toastManager.add({ type: "success", title: gt("Task created"), description: title });
      setCreateModeOpen(false);
      props.onReload();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Couldn't create the task"),
          description: errorDescription(error),
        }),
      );
    } finally {
      createInFlightRef.current = false;
      setSaving(false);
    }
  }, [form, gt, props, selectedProject]);

  // Grouped, a group shows by its server count, even closed with no rows loaded.
  const listEmpty = grouped
    ? groups.length === 0
    : props.tasks.length === 0 || filteredTasks.length === 0;
  const filtersNarrow =
    props.tasks.length > 0 ||
    projectFilter !== null ||
    statusFilter !== ALL_FILTER ||
    filters.lastRun !== ALL_FILTER ||
    filters.tags.length > 0 ||
    archiveFilter !== "active";
  const renderCard = (task: ScopedTaskListItem) => (
    <div
      key={taskKey(task)}
      className="grid"
      data-task-arrival={arrivals.has(taskKey(task)) ? "" : undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "task-arrival-tint") settleArrivals([taskKey(task)]);
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <AgentTaskCard
          task={task}
          project={projectsByKey.get(taskProjectKey(task)) ?? null}
          showProject={showProjectColumn}
          statuses={
            statusOptions.some((status) => sameTaskStatus(status, task.status))
              ? statusOptions
              : [...statusOptions, task.status].sort(compareStatuses)
          }
          canMutate={props.canMutateEnvironment(task.environmentId)}
          dragged={draggedTaskKey === taskKey(task)}
          reorderable={props.canMutateEnvironment(task.environmentId)}
          onDragStart={() => setDraggedTaskKey(taskKey(task))}
          onDragEnd={() => setDraggedTaskKey(null)}
          onMove={(direction) => void persistVisibleMove(task, direction)}
          onOpen={() => openTask(task)}
          onStatusChange={(status) => void updateTaskInline(task, "status", { status })}
          onDrop={() => dropOn(task)}
        />
      </div>
    </div>
  );
  // Auto layout: Runs (w-px) is as narrow as its numbers, and Title (max-w-0) truncates
  // and takes the width the other columns leave.
  const tableHead = (
    <thead className="border-b border-border text-muted-foreground">
      <tr>
        <th className="w-12 py-3 pr-2 font-medium">
          <span className="sr-only">
            {gt("Order", { $context: "column of task order handles" })}
          </span>
        </th>
        {showProjectColumn ? <ProjectIconHeader /> : null}
        <th className="max-w-0 py-3 pr-4 font-medium">{gt("Title")}</th>
        {showStatusColumn ? <th className="w-40 px-4 py-3 font-medium">{gt("Status")}</th> : null}
        <th className="w-56 px-4 py-3 font-medium">{gt("Tags")}</th>
        <th className="w-px py-3 pl-4 text-right font-medium whitespace-nowrap">
          {gt("Runs", { $context: "noun: a task's worker runs" })}
        </th>
      </tr>
    </thead>
  );
  const renderRow = (task: ScopedTaskListItem) => {
    const taskProject = projectsByKey.get(taskProjectKey(task)) ?? null;
    return (
      <tr
        key={taskKey(task)}
        data-task-arrival={arrivals.has(taskKey(task)) ? "" : undefined}
        onAnimationEnd={(event) => {
          if (event.animationName === "task-arrival-tint") settleArrivals([taskKey(task)]);
        }}
        className={`cursor-pointer border-b border-border transition-colors hover:bg-muted/20 ${
          draggedTaskKey === taskKey(task) ? "opacity-50" : ""
        }`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          dropOn(task);
        }}
        onClick={() => openTask(task)}
      >
        <td className="py-3 pr-2 align-middle">{reorderHandle(task)}</td>
        {showProjectColumn ? (
          <ProjectIconCell project={taskProject?.favicon ?? null} name={task.projectName} />
        ) : null}
        <td className="max-w-0 py-4 pr-4 align-middle">
          <button
            type="button"
            className="block max-w-full truncate text-left font-medium text-foreground hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              openTask(task);
            }}
          >
            {task.title}
          </button>
          {taskMetadataLabel(task) || (!showStatusColumn && task.archivedAt) ? (
            <div className="truncate text-muted-foreground">
              {/* Without the Status column, "Archived" moves under the title, as on a card. */}
              {[
                !showStatusColumn && task.archivedAt
                  ? gt("Archived", { $context: "status of an archived task" })
                  : null,
                taskMetadataLabel(task),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}
        </td>
        {showStatusColumn ? (
          <td className="px-4 py-4 align-middle whitespace-nowrap">
            {task.status}
            {task.archivedAt ? (
              <span className="ml-2 text-muted-foreground">
                {gt("Archived", { $context: "status of an archived task" })}
              </span>
            ) : null}
          </td>
        ) : null}
        <td className="max-w-56 px-4 py-4 align-middle">
          <TaskTagChips tags={task.tags} triggerTags={triggerTags} />
        </td>
        <td className="py-4 pl-4 text-right align-middle whitespace-nowrap">
          <TableRunCounts
            groups={groupTaskRunCounts(task.runCounts)}
            onSelect={(group) => openTask(task, group.status)}
          />
        </td>
      </tr>
    );
  };

  const groupBySelect = grouping
    ? {
        groupByStatus: grouped,
        onGroupByStatusChange: (groupByStatus: boolean) =>
          grouping.onSettingsChange({ groupByStatus }),
      }
    : {};
  // A highlight cut short by closing its group does not play again when the group opens.
  const setGroupOpen = (group: TaskStatusGroup<ScopedTaskListItem>, open: boolean) => {
    settleArrivals(group.tasks.map(taskKey));
    grouping?.onSettingsChange({ statusGroupOpen: { [group.key]: open } });
  };
  const groupRows = (group: TaskStatusGroup<ScopedTaskListItem>) =>
    group.tasks.slice(0, groupRowLimits[group.key] ?? GROUP_FIRST_ROWS);
  // The group's next rows, loading the server's next page when the loaded rows run out.
  const groupShowMore = (group: TaskStatusGroup<ScopedTaskListItem>, row: boolean) => {
    const limit = groupRowLimits[group.key] ?? GROUP_FIRST_ROWS;
    const paging = grouping?.paging.get(group.key);
    const hidden = Math.max(group.count, group.tasks.length) - limit;
    if (!grouping || hidden <= 0 || (group.tasks.length <= limit && !paging?.hasMore)) return null;
    return (
      <TaskGroupShowMore
        row={row}
        columnCount={showProjectColumn ? 5 : 4}
        hidden={hidden}
        onShowMore={() => {
          const next = limit + GROUP_MORE_ROWS;
          setGroupRowLimits((limits) => ({ ...limits, [group.key]: next }));
          if (group.tasks.length < next && paging?.hasMore) grouping.onLoadGroup(group.key);
        }}
      />
    );
  };

  const detailOuterClass = stackedDetail
    ? "flex w-full min-w-0 py-3"
    : "flex min-h-0 w-full flex-1 py-5";
  const detailInnerClass = stackedDetail
    ? "flex min-w-0 flex-1 flex-col gap-3"
    : "flex min-h-0 min-w-0 flex-1 gap-5";

  return (
    <WorkspaceViewLayout
      variant={props.layout}
      floatingControls={props.floatingControls === true}
      {...(selectedTask
        ? {}
        : createModeOpen
          ? { title: gt("New task") }
          : { switches: props.viewSwitch })}
      action={
        selectedTask
          ? props.canMutateEnvironment(selectedTask.environmentId)
            ? {
                ariaLabel: selectedTask.archivedAt ? gt("Unarchive task") : gt("Archive task"),
                track: selectedTask.archivedAt ? "tasks.unarchive" : "tasks.archive",
                disabled: updatingField === "archive",
                hideIcon: true,
                label: selectedTask.archivedAt
                  ? gt("Unarchive", { $context: "button that unarchives a task" })
                  : gt("Archive", { $context: "button that archives a task" }),
                onClick: () => {
                  void setTaskArchived(selectedTask, selectedTask.archivedAt === null);
                },
              }
            : undefined
          : createModeOpen
            ? {
                ariaLabel: gt("Create task"),
                track: "tasks.create_save",
                disabled: mutableProjects.length === 0 || saving,
                hideIcon: true,
                label: gt("Create", { $context: "button that creates a task" }),
                onClick: () => {
                  void save();
                },
              }
            : SHOW_MANUAL_CREATE_ACTIONS.tasks
              ? {
                  ariaLabel: gt("Create task"),
                  track: "tasks.create",
                  disabled: mutableProjects.length === 0 || saving,
                  onClick: openCreate,
                }
              : undefined
      }
      leadingAction={
        selectedTask || createModeOpen
          ? {
              ariaLabel: selectedTask ? gt("Back to tasks") : gt("Cancel task creation"),
              track: selectedTask ? "tasks.back" : "tasks.create_cancel",
              disabled: createModeOpen && saving,
              icon: <ArrowLeftIcon className="size-4" />,
              onClick: selectedTask
                ? props.onNavigateBack
                : () => {
                    if (!createInFlightRef.current) setCreateModeOpen(false);
                  },
            }
          : undefined
      }
      toolbar={
        selectedTask ? (
          <>
            <span className="shrink-0 text-sm font-medium text-blue-400" title={selectedTask.id}>
              {shortTaskId(selectedTask.id)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {selectedTask.title}
            </span>
            {selectedTask.archivedAt ? (
              <span className="shrink-0 text-sm text-muted-foreground">
                {gt("Archived", { $context: "status of an archived task" })}
              </span>
            ) : null}
          </>
        ) : createModeOpen ? undefined : (
          <>
            {cards ? (
              // A margin, not a spacer, pushes it right: a spacer adds a gap the phone header lacks.
              <div className="ms-auto flex shrink-0">
                <TaskFiltersButton
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  statusOptions={statusOptions}
                  tagOptions={tagOptions}
                  {...groupBySelect}
                  projectSelect={props.projectSelect}
                  projectChosen={projectFilter !== null}
                  onProjectReset={() => props.onProjectFilterReset?.()}
                />
              </div>
            ) : (
              <>
                <span className="min-w-0 flex-1" />
                {props.projectSelect}
                <TaskFilterRow
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  statusOptions={statusOptions}
                  tagOptions={tagOptions}
                  {...groupBySelect}
                />
              </>
            )}
          </>
        )
      }
      onNavigateBack={
        selectedTask
          ? props.onNavigateBack
          : createModeOpen
            ? () => {
                if (!createInFlightRef.current) setCreateModeOpen(false);
              }
            : props.onNavigateBack
      }
    >
      {selectedTask ? (
        <div className={detailOuterClass}>
          <div className={detailInnerClass}>
            <main className={stackedDetail ? "min-w-0" : "min-h-0 min-w-0 flex-1 overflow-y-auto"}>
              <DetailSidebarSection
                key={`${taskKey(selectedTask)}:description`}
                title={gt("Description")}
                defaultOpen={!hasSelectedTaskOutput}
              >
                {props.canMutateEnvironment(selectedTask.environmentId) ? (
                  <DetailDescriptionEditor
                    key={`${taskKey(selectedTask)}:description-editor`}
                    value={selectedTask.description}
                    disabled={updatingField === "description"}
                    onSave={(description) =>
                      void updateTaskInline(selectedTask, "description", { description })
                    }
                  />
                ) : selectedTask.description.trim() ? (
                  <p className="whitespace-pre-wrap px-3 py-2 text-lg leading-8 text-foreground">
                    {selectedTask.description}
                  </p>
                ) : (
                  <p className="px-3 py-2 text-sm text-muted-foreground">{gt("No description.")}</p>
                )}
              </DetailSidebarSection>
              {hasSelectedTaskOutput ? (
                <DetailSidebarSection
                  key={`${taskKey(selectedTask)}:output`}
                  title={gt("Output")}
                  defaultOpen
                >
                  <TaskOutput
                    text={selectedTask.output ?? ""}
                    environmentId={selectedTask.environmentId}
                    cwd={selectedTaskProject?.workspaceRoot}
                    filePanelRef={props.filePanelRef}
                    fileWindow={{
                      projectName: selectedTask.projectName ?? "Project",
                      projectId: selectedTask.projectId as ProjectId,
                      onOpenInThread: latestRun
                        ? (absolutePath, line) => {
                            const threadRef = {
                              environmentId: latestRun.environmentId,
                              threadId: latestRun.threadId,
                            };
                            openFileInWorkerThread(threadRef, absolutePath, line);
                            props.onOpenThread(latestRun.environmentId, latestRun.threadId);
                          }
                        : undefined,
                    }}
                    quoteSource={{
                      id: selectedTask.id,
                      title: selectedTask.title,
                      projectId: selectedTask.projectId,
                      rootThreadId: selectedTask.rootThreadId,
                    }}
                    onOpenThread={props.onOpenThread}
                  />
                </DetailSidebarSection>
              ) : null}
            </main>
            <DetailColumn stacked={stackedDetail}>
              <DetailSidebarSection title={gt("Details")}>
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow
                    label={gt("Title")}
                    controlSelector={
                      props.canMutateEnvironment(selectedTask.environmentId) ? "input" : undefined
                    }
                  >
                    {props.canMutateEnvironment(selectedTask.environmentId) ? (
                      <input
                        key={`${selectedTask.updatedAt}:title`}
                        className={DETAIL_INPUT_CLASS}
                        defaultValue={selectedTask.title}
                        disabled={updatingField === "title"}
                        aria-label={gt("Task title")}
                        onBlur={(event) => {
                          const title = event.currentTarget.value.trim();
                          if (title && title !== selectedTask.title)
                            void updateTaskInline(selectedTask, "title", { title });
                          else event.currentTarget.value = selectedTask.title;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            event.currentTarget.value = selectedTask.title;
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      selectedTask.title
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow
                    label={gt("Status")}
                    controlSelector={
                      props.canMutateEnvironment(selectedTask.environmentId) ? "button" : undefined
                    }
                  >
                    {props.canMutateEnvironment(selectedTask.environmentId) ? (
                      <Select
                        value={selectedTask.status}
                        onValueChange={(status) => {
                          if (!status || status === selectedTask.status) return;
                          void updateTaskInline(selectedTask, "status", { status });
                        }}
                      >
                        <SelectTrigger
                          className={DETAIL_SELECT_TRIGGER_CLASS}
                          style={{ color: "var(--foreground)" }}
                          variant="ghost"
                          aria-label={gt("Task status")}
                        >
                          <SelectValue>{selectedTask.status}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {statusOptions.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      selectedTask.status
                    )}
                  </DetailSidebarRow>
                  {selectedTask.kind === "routine" ? null : (
                    <DetailSidebarRow
                      label={gt("For", { $context: "who a task is for" })}
                      controlSelector={
                        props.canMutateEnvironment(selectedTask.environmentId)
                          ? "button"
                          : undefined
                      }
                    >
                      {props.canMutateEnvironment(selectedTask.environmentId) ? (
                        <Select
                          value={selectedTask.audience}
                          onValueChange={(audience) => {
                            if (audience !== "agent" && audience !== "person") return;
                            if (audience === selectedTask.audience) return;
                            const task = selectedTask;
                            void updateTaskInline(task, "audience", { audience }).then((moved) => {
                              if (!moved) return;
                              toastAudienceMoved(
                                audience,
                                task.title,
                                () =>
                                  audience === "person"
                                    ? props.onOpenInPlanner?.(task.environmentId, task.id)
                                    : selectTaskKey(taskKey(task)),
                                gt,
                              );
                            });
                          }}
                        >
                          <SelectTrigger
                            className={DETAIL_SELECT_TRIGGER_CLASS}
                            style={{ color: "var(--foreground)" }}
                            variant="ghost"
                            aria-label={gt("For", { $context: "who a task is for" })}
                            disabled={updatingField === "audience"}
                          >
                            <SelectValue>{m(AUDIENCE_LABELS[selectedTask.audience])}</SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="agent">{m(AUDIENCE_LABELS.agent)}</SelectItem>
                            <SelectItem value="person">{m(AUDIENCE_LABELS.person)}</SelectItem>
                          </SelectPopup>
                        </Select>
                      ) : (
                        m(AUDIENCE_LABELS[selectedTask.audience])
                      )}
                    </DetailSidebarRow>
                  )}
                  <DetailSidebarRow label={gt("ID")}>
                    <button
                      type="button"
                      className="max-w-full truncate font-mono text-xs hover:underline"
                      title={gt("Copy task ID")}
                      onClick={() => {
                        void navigator.clipboard.writeText(selectedTask.id).then(
                          () => toastManager.add({ type: "success", title: gt("Task ID copied") }),
                          () =>
                            toastManager.add({
                              type: "error",
                              title: gt("Could not copy task ID"),
                            }),
                        );
                      }}
                    >
                      {selectedTask.id}
                    </button>
                  </DetailSidebarRow>
                  <DetailSidebarRow
                    label={gt("Project")}
                    controlSelector={
                      props.canMutateEnvironment(selectedTask.environmentId) ? "button" : undefined
                    }
                  >
                    {props.canMutateEnvironment(selectedTask.environmentId) ? (
                      <Select
                        value={
                          (selectedTaskProject
                            ? pickerProjectFor(selectedTaskEnvironmentProjects, selectedTaskProject)
                                ?.id
                            : undefined) ??
                          selectedTask.projectId ??
                          ""
                        }
                        onValueChange={(projectId) => {
                          if (
                            !projectId ||
                            sameProjectGroup(props.projects, projectId, selectedTask.projectId)
                          ) {
                            return;
                          }
                          void updateTaskInline(selectedTask, "project", {
                            projectId: projectId as ProjectId,
                          });
                        }}
                      >
                        <SelectTrigger
                          className={DETAIL_SELECT_TRIGGER_CLASS}
                          variant="ghost"
                          aria-label={gt("Task project")}
                        >
                          <SelectValue>
                            <span className="flex min-w-0 items-center justify-end gap-2 text-foreground">
                              {selectedTaskProject ? (
                                <ProjectFavicon
                                  project={selectedTaskProject.favicon}
                                  className="size-4 shrink-0"
                                />
                              ) : null}
                              <span className="truncate">
                                {selectedTaskProject?.name ??
                                  selectedTask.projectName ??
                                  gt("No project")}
                              </span>
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {selectedTaskEnvironmentProjects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      <span className="flex min-w-0 items-center justify-end gap-2 text-foreground">
                        {selectedTaskProject ? (
                          <ProjectFavicon
                            project={selectedTaskProject.favicon}
                            className="size-4"
                          />
                        ) : null}
                        <span className="truncate">
                          {selectedTask.projectName ?? gt("No project")}
                        </span>
                      </span>
                    )}
                  </DetailSidebarRow>
                  {/* A person task's tags stay hidden; the planner hands it to an agent. */}
                  {selectedTask.audience === "person" ? null : (
                    <DetailSidebarRow label={gt("Tags")}>
                      {props.canMutateEnvironment(selectedTask.environmentId) ? (
                        <TagChipsField
                          tags={selectedTask.tags}
                          disabled={updatingField === "tags"}
                          suggest={(query) =>
                            tagSuggestions({
                              query,
                              taskTags: selectedTask.tags,
                              projectId: selectedTask.projectId,
                              agents: props.agents.filter(
                                (agent) => agent.environmentId === selectedTask.environmentId,
                              ),
                              knownTags: tagOptions,
                            })
                          }
                          onChange={(tags) => void updateTaskInline(selectedTask, "tags", { tags })}
                        />
                      ) : selectedTask.tags.length > 0 ? (
                        selectedTask.tags.join(", ")
                      ) : (
                        gt("None", { $context: "a task has no tags" })
                      )}
                    </DetailSidebarRow>
                  )}
                  <DetailSidebarRow label={gt("Created", { $context: "date a task was created" })}>
                    {new Date(selectedTask.createdAt).toLocaleDateString()}
                  </DetailSidebarRow>
                  <DetailSidebarRow
                    label={gt("Updated", { $context: "date a task was last updated" })}
                  >
                    {new Date(selectedTask.updatedAt).toLocaleDateString()}
                  </DetailSidebarRow>
                  {selectedTask.archivedAt ? (
                    <DetailSidebarRow
                      label={gt("Archived", { $context: "date a task was archived" })}
                    >
                      {new Date(selectedTask.archivedAt).toLocaleString()}
                    </DetailSidebarRow>
                  ) : null}
                  {selectedTask.notBefore ? (
                    <DetailSidebarRow label={gt("Not before")}>
                      {new Date(selectedTask.notBefore).toLocaleString()}
                    </DetailSidebarRow>
                  ) : null}
                </dl>
              </DetailSidebarSection>
              {selectedTask.sourceThreadId ? (
                <DetailSidebarSection title={gt("Source thread")}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <TaskThreadLink
                      environmentId={selectedTask.environmentId}
                      threadId={selectedTask.sourceThreadId as ThreadId}
                      title={gt("Source thread")}
                      onOpen={props.onOpenThread}
                    />
                  </div>
                </DetailSidebarSection>
              ) : null}
              <DetailSidebarSection title={gt("Active runs")} count={activeRuns.length}>
                {activeRuns.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {detailRunsStatus === "loading"
                      ? gt("Loading active runs…")
                      : detailRunsStatus === "error"
                        ? gt("Could not refresh active runs.")
                        : gt("No active runs.")}
                  </p>
                ) : (
                  activeRuns.map((run) => {
                    const { agentName, modelLabel } = getTaskRunAgentPresentation(
                      run,
                      props.agents,
                      props.providerEntriesByEnvironment.get(run.environmentId),
                      gt,
                    );
                    return (
                      <TaskThreadLink
                        key={run.id}
                        environmentId={run.environmentId}
                        threadId={run.threadId}
                        title={agentName}
                        label={agentName}
                        detail={modelLabel}
                        runStatus={run.status}
                        onOpen={props.onOpenThread}
                      />
                    );
                  })
                )}
              </DetailSidebarSection>
              <DetailSidebarSection
                title={gt("Runs", { $context: "noun: a task's worker runs" })}
                count={detailRuns.length}
              >
                {runFilter !== ALL_FILTER ? (
                  <div className="flex items-center justify-between px-2 py-2 text-sm">
                    <span>{m(taskRunPresentation(runFilter, false)?.label)}</span>
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => setRunFilter(ALL_FILTER)}
                    >
                      {gt("Show all runs")}
                    </button>
                  </div>
                ) : null}
                {detailRunsStatus === "error" ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
                    {gt("Could not refresh this task's worker runs. Showing cached results.")}
                  </div>
                ) : null}
                {detailRunsStatus === "loading" && taskThreads.length === 0 ? (
                  <div className="px-2 py-5 text-sm text-muted-foreground">
                    {gt("Loading worker runs...")}
                  </div>
                ) : taskThreads.length === 0 ? (
                  <div className="px-2 py-5 text-sm text-muted-foreground">
                    {runFilter === ALL_FILTER
                      ? gt("No worker has worked on this task yet.")
                      : gt("No runs match this status.")}
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {taskThreads.map((run) => {
                      const { agentName, modelLabel } = getTaskRunAgentPresentation(
                        run,
                        props.agents,
                        props.providerEntriesByEnvironment.get(run.environmentId),
                        gt,
                      );
                      return (
                        <TaskThreadLink
                          key={`${run.environmentId}:${run.id}`}
                          environmentId={run.environmentId}
                          threadId={run.threadId}
                          title={agentName}
                          label={agentName}
                          detail={modelLabel}
                          runStatus={run.status}
                          timestamp={run.startedAt}
                          onOpen={props.onOpenThread}
                        />
                      );
                    })}
                  </div>
                )}
                {moreRuns ? (
                  <button
                    type="button"
                    disabled={detailRunsStatus === "loading"}
                    className="px-2 py-3 text-sm hover:underline"
                    onClick={() => loadTaskRuns(selectedTask, true)}
                  >
                    {gt("Load more runs")}
                  </button>
                ) : null}
              </DetailSidebarSection>
              <DetailSidebarSection title={gt("History")} count={historyEntries.length}>
                <TaskHistory
                  entries={historyEntries}
                  status={history.taskKey === taskKey(selectedTask) ? history.status : "loading"}
                />
              </DetailSidebarSection>
            </DetailColumn>
          </div>
        </div>
      ) : createModeOpen ? (
        <div className={detailOuterClass}>
          <div className={detailInnerClass}>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <LazyMarkdownEditor
                value={form.description}
                placeholder={gt("Description…")}
                ariaLabel={gt("Task description")}
                className={DESCRIPTION_EDITOR_CLASS}
                onChange={(description) => setForm((current) => ({ ...current, description }))}
              />
            </main>
            <DetailColumn stacked={stackedDetail}>
              <DetailSidebarSection title={gt("Details")}>
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label={gt("Title")} controlSelector="input">
                    <input
                      autoFocus
                      className={DETAIL_INPUT_CLASS}
                      value={form.title}
                      placeholder={gt("Task title…")}
                      aria-label={gt("Task title")}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Project")} controlSelector="button">
                    <Select
                      value={
                        selectedProjectOption
                          ? projectKey(selectedProjectOption)
                          : selectedProjectKey(form)
                      }
                      onValueChange={(value) => {
                        const project = projectOptions.find(
                          (candidate) => projectKey(candidate) === value,
                        );
                        if (project && project !== selectedProjectOption)
                          setForm((current) => ({
                            ...current,
                            environmentId: project.environmentId,
                            projectId: project.id,
                          }));
                      }}
                    >
                      <SelectTrigger
                        className={DETAIL_SELECT_TRIGGER_CLASS}
                        variant="ghost"
                        aria-label={gt("Task project")}
                      >
                        <SelectValue>
                          {selectedProject ? (
                            <span className="flex min-w-0 items-center justify-end gap-2 text-foreground">
                              <ProjectFavicon
                                project={selectedProject.favicon}
                                className="size-4 shrink-0"
                              />
                              <span className="truncate text-foreground">
                                {selectedProject.name}
                              </span>
                            </span>
                          ) : (
                            gt("Select project")
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {projectOptions.map((project) => (
                          <SelectItem key={projectKey(project)} value={projectKey(project)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Status")} controlSelector="input">
                    <input
                      className={DETAIL_INPUT_CLASS}
                      value={form.status}
                      placeholder={DEFAULT_TASK_STATUS}
                      aria-label={gt("Task status")}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, status: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label={gt("Tags")}>
                    <TagChipsField
                      tags={splitListInput(form.tags)}
                      suggest={(query) =>
                        tagSuggestions({
                          query,
                          taskTags: splitListInput(form.tags),
                          projectId: form.projectId || null,
                          agents: props.agents.filter(
                            (agent) => agent.environmentId === form.environmentId,
                          ),
                          knownTags: tagOptions,
                        })
                      }
                      onChange={(tags) =>
                        setForm((current) => ({ ...current, tags: tags.join(", ") }))
                      }
                    />
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
            </DetailColumn>
          </div>
        </div>
      ) : (
        // Measured: as wide as the content in either layout. Cards run edge to edge in the
        // planner list's own scroller and column, so both lists match.
        <div
          ref={setListElement}
          className={cards ? "flex min-h-0 w-full min-w-0 flex-1 flex-col" : "w-full min-w-0"}
        >
          <div
            className={
              cards
                ? `${LIST_SCROLL_CLASS} -mr-(--workspace-gutter-end) -ml-(--workspace-gutter-start)`
                : `flex w-full min-w-0 flex-col ${panel ? "gap-3 py-3" : "gap-5 py-6"}`
            }
          >
            <div
              className={
                cards
                  ? `flex min-h-full flex-col ${LIST_CLASS} ${props.floatingControls ? FLOATING_ACTIONS_CLEARANCE_CLASS : ""}`
                  : "contents"
              }
            >
              <div
                className={
                  cards
                    ? "flex flex-col gap-3 pr-(--workspace-gutter-end) pb-2 pl-(--workspace-gutter-start) empty:hidden"
                    : "contents"
                }
              >
                {environmentCount > 1 ? (
                  <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                    {gt(
                      "Task order is global within each connected environment. Environments are grouped deterministically, and tasks cannot be dragged across that storage boundary.",
                    )}
                  </div>
                ) : null}
                {hasReadOnlyProjects ? (
                  <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                    {gt(
                      "Existing tasks from unavailable or expired extensions remain readable. Mutation controls are hidden for those environments.",
                    )}
                  </div>
                ) : null}
                {selectedTaskKey ? (
                  <p className="text-sm text-muted-foreground">
                    {m(detailError) ?? gt("Loading task…")}
                  </p>
                ) : null}
                {props.status === "error" ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
                    {gt("Up.computer couldn't load your tasks. {reason}", {
                      reason: props.errorMessage ?? gt("Try again."),
                    })}
                    <button type="button" className="ml-3 underline" onClick={props.onReload}>
                      {gt("Retry")}
                    </button>
                  </div>
                ) : props.status === "offline" && props.tasks.length > 0 ? (
                  <div className={OFFLINE_NOTE_CLASS}>{m(TASKS_OFFLINE_TEXT)}</div>
                ) : null}
                {props.status === "offline"
                  ? null
                  : props.offlineEnvironmentIds?.map((environmentId) => (
                      <OfflineComputerNote
                        key={environmentId}
                        environmentId={environmentId}
                        showsRows={props.tasks.some((task) => task.environmentId === environmentId)}
                      />
                    ))}
              </div>

              {listEmpty ? (
                // Blank while the list loads: it arrives within a moment.
                props.status === "loading" ? null : props.status === "offline" ? (
                  <ListEmptyState title={gt("Tasks unavailable")} hint={m(TASKS_OFFLINE_TEXT)} />
                ) : filtersNarrow ? (
                  <ListEmptyState title={gt("No tasks match the current filters")} />
                ) : (
                  <ListEmptyState
                    title={gt("No tasks yet")}
                    hint={gt("Click + to add one, or ask any thread to plan the work for you.")}
                  />
                )
              ) : grouped && grouping ? (
                <TaskStatusGroupsProvider
                  groups={groups}
                  onReorder={(shown, moved) =>
                    grouping.onSettingsChange({
                      statusGroupOrder: mergedGroupOrder(groupOrder, shown, moved),
                    })
                  }
                  overlayClassName={cards ? "mx-2 px-1" : "ms-0.5 me-2"}
                  lineInset={cards ? 8 : 0}
                >
                  {cards ? (
                    <div className="flex min-w-0 flex-col">
                      {groups.map((group) => (
                        <TaskStatusCardGroup
                          key={group.key}
                          group={group}
                          onOpenChange={(open) => setGroupOpen(group, open)}
                        >
                          {groupRows(group).map(renderCard)}
                          {groupShowMore(group, false)}
                        </TaskStatusCardGroup>
                      ))}
                    </div>
                  ) : (
                    // No scroller of its own here: a group's header sticks to the page's.
                    <div className="min-w-0">
                      <table className={TABLE_CLASS}>
                        {tableHead}
                        {groups.map((group) => (
                          <TaskStatusTableGroup
                            key={group.key}
                            group={group}
                            columnCount={showProjectColumn ? 5 : 4}
                            onOpenChange={(open) => setGroupOpen(group, open)}
                          >
                            {groupRows(group).map(renderRow)}
                            {groupShowMore(group, true)}
                          </TaskStatusTableGroup>
                        ))}
                      </table>
                    </div>
                  )}
                </TaskStatusGroupsProvider>
              ) : cards ? (
                <div className="flex min-w-0 flex-col">{filteredTasks.map(renderCard)}</div>
              ) : (
                <div className="min-w-0 overflow-x-auto">
                  <table className={TABLE_CLASS}>
                    {tableHead}
                    <tbody>{filteredTasks.map(renderRow)}</tbody>
                  </table>
                </div>
              )}
              {/* Grouped, a group loads as it scrolls; Load more stays for a server without counts. */}
              {props.hasMore ? (
                cards ? (
                  <div className="flex justify-center py-4">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.loadingMore}
                      onClick={props.onLoadMore}
                    >
                      {props.loadingMore ? gt("Loading…") : gt("Load more tasks")}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={props.loadingMore}
                    className="self-center rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    onClick={props.onLoadMore}
                  >
                    {props.loadingMore ? gt("Loading…") : gt("Load more tasks")}
                  </button>
                )
              ) : null}
            </div>
          </div>
        </div>
      )}
    </WorkspaceViewLayout>
  );
}
