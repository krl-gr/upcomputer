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
import {
  TASK_HISTORY_EVENT_KINDS,
  TaskId,
  type TaskArchiveFilter,
  type TaskAudience,
  type TaskEvent,
} from "@t3tools/tasks-contracts/v1";
import { taskRunPresentation, groupTaskRunCounts, runSearchStatus } from "./taskRunPresentation.ts";
import type { ScopedTaskListItem } from "../state/taskPages.ts";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

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
import ChatMarkdown from "../../../../apps/web/src/components/ChatMarkdown.tsx";
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
import { TaskCard } from "./TaskCard.tsx";
import { TaskFilterRow, TaskFiltersButton } from "./TaskFilters.tsx";
import { taskListLayout } from "./taskListLayout.ts";
import { isInboxRoot, type PlannerProject } from "../planner/ui/ProjectChip.tsx";
import { LIST_CLASS, LIST_SCROLL_CLASS } from "../planner/ui/rowShell.ts";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { observeResize } from "../../../../apps/web/src/lib/observeResize.ts";
import { TableRunCounts } from "./RunCountNumbers.tsx";
import { TaskHistory, taskHistoryEntries } from "./TaskHistory.tsx";
import { TaskTagChips } from "./TaskTagChips.tsx";
import { TagChipsField } from "./TagChipsField.tsx";
import { tagSuggestions } from "./tagSuggestions.ts";
import { LazyMarkdownEditor } from "../markdown/LazyMarkdownEditor.tsx";
import { splitListInput, taskKey, taskMetadataLabel, type TasksWebProject } from "./shared.ts";
import { plainErrorSentence } from "@t3tools/client-runtime/errors";

const STATUS_ORDER = [
  "new",
  "to do",
  "backlog",
  "restored",
  "in progress",
  "ready for review",
  "done",
  "closed",
];

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
const AUDIENCE_LABELS: Record<TaskAudience, string> = { agent: "Workers", person: "Me" };
const TASKS_OFFLINE_TEXT =
  "The environment with Tasks is not reachable right now. Tasks show when it connects.";

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
  /** Task status (server), last run (client), tags (server, all required) and archive (server). */
  readonly filters: TasksPageFilters;
  readonly onFiltersChange: (filters: TasksPageFilters) => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly agents: readonly ScopedTaskAgent[];
  readonly runs: readonly ScopedTaskAgentRun[];
  /** Resolves run harness and model display names. */
  readonly providerEntriesByEnvironment: ReadonlyMap<
    EnvironmentId,
    readonly ProviderInstanceEntry[]
  >;
  readonly status: "loading" | "ready" | "error" | "offline";
  readonly errorMessage?: string;
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
}

function emptyForm(project?: TasksWebProject): TaskFormState {
  return {
    title: "",
    environmentId: project?.environmentId ?? null,
    projectId: project?.id ?? "",
    status: "new",
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
      placeholder="Description…"
      ariaLabel="Task description"
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
  const leftIndex = STATUS_ORDER.indexOf(left.toLowerCase());
  const rightIndex = STATUS_ORDER.indexOf(right.toLowerCase());
  if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return leftIndex - rightIndex;
}

export function TaskReorderHandle(props: {
  readonly task: ScopedTask;
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
      aria-label={`Reorder ${props.task.title}`}
      title="Drag to reorder globally. Worker queues run from the bottom, so lower runs sooner. With filters, the task is placed between the visible neighbors; hidden tasks keep their order."
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
  const [detailError, setDetailError] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(() => emptyForm(props.projects[0]));
  const [saving, setSaving] = useState(false);
  const createInFlightRef = useRef(false);
  const [updatingField, setUpdatingField] = useState<string | null>(null);
  const { projectFilter, filters, onFiltersChange } = props;
  const panel = props.layout === "panel";
  // The list's own width picks table or cards; the first measurement lands before paint.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [listWidth, setListWidth] = useState<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the list element's DOM width
  useLayoutEffect(() => {
    if (!listElement) return;
    setListWidth(listElement.getBoundingClientRect().width);
    return observeResize(listElement, (entries) => {
      const entry = entries.at(-1);
      if (entry) setListWidth(entry.contentRect.width);
    });
  }, [listElement]);
  const cards = taskListLayout({ panel, width: listWidth }) === "cards";
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
  // A card's project chip offers the projects of its task's environment.
  const plannerProjectsByEnvironment = useMemo(() => {
    const byEnvironment = new Map<EnvironmentId, PlannerProject[]>();
    for (const project of props.projects) {
      const list = byEnvironment.get(project.environmentId) ?? [];
      list.push({
        id: project.id,
        name: project.name,
        favicon: project.favicon,
        inbox: isInboxRoot(project.workspaceRoot),
      });
      byEnvironment.set(project.environmentId, list);
    }
    return byEnvironment;
  }, [props.projects]);
  const selectedTaskProject = selectedTask
    ? (projectsByKey.get(taskProjectKey(selectedTask)) ?? null)
    : null;
  const taskThreads = detailRuns;
  const mutableProjects = props.projects.filter((project) =>
    props.canMutateEnvironment(project.environmentId),
  );
  const hasReadOnlyProjects = mutableProjects.length < props.projects.length;
  const statusOptions = useMemo(
    () =>
      [
        ...new Set([
          ...props.statuses,
          ...(statusFilter === ALL_FILTER ? [] : [statusFilter]),
          ...(selectedTask ? [selectedTask.status] : []),
        ]),
      ].sort(compareStatuses),
    [props.statuses, selectedTask, statusFilter],
  );
  // The last-run filter is applied here, to the rows the server returned.
  const filteredTasks = useMemo(
    () => optimisticTasks.filter((task) => matchesLastRunFilter(task, filters.lastRun)),
    [filters.lastRun, optimisticTasks],
  );
  const triggerTags = useMemo(() => agentTriggerTags(props.agents), [props.agents]);
  const tagOptions = useMemo(
    () =>
      [
        ...new Set([...props.tasks.flatMap((task) => task.tags), ...triggerTags, ...filters.tags]),
      ].sort((left, right) => left.localeCompare(right)),
    [filters.tags, props.tasks, triggerTags],
  );
  const showProjectColumn = projectFilter === null;
  const environmentCount = new Set(props.tasks.map(({ environmentId }) => environmentId)).size;

  const persistVisibleMove = useCallback(
    async (task: ScopedTaskListItem, directionOrTarget: "up" | "down" | ScopedTaskListItem) => {
      if (reorderInFlightRef.current || !props.canMutateEnvironment(task.environmentId)) return;
      const result = planVisibleTaskMove({
        tasks: optimisticTasks,
        visibleTasks: filteredTasks,
        task,
        directionOrTarget,
      });
      if (!result.ok) {
        if (result.reason === "cross-environment") {
          toastManager.add({
            type: "error",
            title: "Tasks can only be reordered within one environment",
          });
        }
        return;
      }

      const previous = optimisticTasks;
      reorderInFlightRef.current = true;
      try {
        const client = props.getClient(task.environmentId);
        if (!client) throw new Error("The computer with your tasks isn't connected.");
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
            title: "Couldn't move the task",
            description: errorDescription(error),
          }),
        );
      } finally {
        reorderInFlightRef.current = false;
      }
    },
    [filteredTasks, optimisticTasks, props],
  );

  const dropOn = (task: ScopedTaskListItem) => {
    const dragged = optimisticTasks.find((candidate) => taskKey(candidate) === draggedTaskKey);
    setDraggedTaskKey(null);
    if (dragged && taskKey(dragged) !== taskKey(task)) void persistVisibleMove(dragged, task);
  };
  const reorderHandle = (task: ScopedTaskListItem) => (
    <TaskReorderHandle
      task={task}
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
    setForm(emptyForm(preferredProject(mutableProjects, orderedProjectFilterKeys(projectFilter))));
    setCreateModeOpen(true);
  }, [mutableProjects, projectFilter, selectTaskKey]);

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
      setDetailError("Couldn't open this task: the computer with your tasks isn't connected.");
      return;
    }
    const refresh = () => {
      const current = ++request;
      void client.tasks.get({ id: TaskId.make(id) }).then(
        (task) => {
          if (cancelled || request !== current) return;
          if (!task) {
            setFetchedTask(null);
            setDetailError("Task not found.");
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
          if (!cancelled && request === current) setDetailError("Could not refresh task.");
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
        if (!cancelled) setDetailError("Task updates are temporarily unavailable.");
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
            title: "Couldn't save the task",
            description: errorDescription(error),
          }),
        );
        return false;
      } finally {
        setUpdatingField(null);
      }
    },
    [props],
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
    return taskHistoryEntries(history.events, (runId) => {
      const agentId = agentIdByRun.get(runId);
      return agentId === undefined ? null : (agentNames.get(agentId) ?? null);
    });
  }, [detailRuns, history, props.agents, selectedTask]);

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
          title: archived ? "Task archived" : "Task unarchived",
          description: task.title,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: archived ? "Failed to archive task" : "Failed to unarchive task",
            description: errorDescription(error),
          }),
        );
      } finally {
        setUpdatingField(null);
      }
    },
    [props],
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
          ? "Select a project"
          : !title
            ? "Task title is required"
            : "Task status is required",
      });
      return;
    }
    const client = props.getClient(target.environmentId);
    if (!client) {
      toastManager.add({
        type: "error",
        title: "Couldn't create the task",
        description: "The computer with your tasks isn't connected. Reconnect, then try again.",
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
      toastManager.add({ type: "success", title: "Task created", description: title });
      setCreateModeOpen(false);
      props.onReload();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn't create the task",
          description: errorDescription(error),
        }),
      );
    } finally {
      createInFlightRef.current = false;
      setSaving(false);
    }
  }, [form, props, selectedProject]);

  const detailOuterClass = panel ? "flex w-full min-w-0 py-3" : "flex min-h-0 w-full flex-1 py-5";
  const detailInnerClass = panel
    ? "flex min-w-0 flex-1 flex-col gap-3"
    : "flex min-h-0 min-w-0 flex-1 gap-5";

  return (
    <WorkspaceViewLayout
      variant={props.layout}
      title={selectedTask ? "" : createModeOpen ? "New task" : panel ? "" : "Tasks"}
      action={
        selectedTask
          ? props.canMutateEnvironment(selectedTask.environmentId)
            ? {
                ariaLabel: selectedTask.archivedAt ? "Unarchive task" : "Archive task",
                track: selectedTask.archivedAt ? "tasks.unarchive" : "tasks.archive",
                disabled: updatingField === "archive",
                hideIcon: true,
                label: selectedTask.archivedAt ? "Unarchive" : "Archive",
                onClick: () => {
                  void setTaskArchived(selectedTask, selectedTask.archivedAt === null);
                },
              }
            : undefined
          : createModeOpen
            ? {
                ariaLabel: "Create task",
                track: "tasks.create_save",
                disabled: mutableProjects.length === 0 || saving,
                hideIcon: true,
                label: "Create",
                onClick: () => {
                  void save();
                },
              }
            : SHOW_MANUAL_CREATE_ACTIONS.tasks
              ? {
                  ariaLabel: "Create task",
                  track: "tasks.create",
                  disabled: mutableProjects.length === 0 || saving,
                  onClick: openCreate,
                }
              : undefined
      }
      leadingAction={
        selectedTask || createModeOpen
          ? {
              ariaLabel: selectedTask ? "Back to tasks" : "Cancel task creation",
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
              <span className="shrink-0 text-sm text-muted-foreground">Archived</span>
            ) : null}
          </>
        ) : createModeOpen ? undefined : (
          <>
            {props.viewSwitch}
            <span className="min-w-0 flex-1" />
            {cards ? (
              <TaskFiltersButton
                filters={filters}
                onFiltersChange={onFiltersChange}
                statusOptions={statusOptions}
                tagOptions={tagOptions}
                projectSelect={props.projectSelect}
                projectChosen={projectFilter !== null}
                onProjectReset={() => props.onProjectFilterReset?.()}
              />
            ) : (
              <>
                {props.projectSelect}
                <TaskFilterRow
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  statusOptions={statusOptions}
                  tagOptions={tagOptions}
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
            <main className={panel ? "min-w-0" : "min-h-0 min-w-0 flex-1 overflow-y-auto"}>
              <DetailSidebarSection
                key={`${taskKey(selectedTask)}:description`}
                title="Description"
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
                  <p className="px-3 py-2 text-sm text-muted-foreground">No description.</p>
                )}
              </DetailSidebarSection>
              {hasSelectedTaskOutput ? (
                <DetailSidebarSection
                  key={`${taskKey(selectedTask)}:output`}
                  title="Output"
                  defaultOpen
                >
                  <ChatMarkdown
                    text={selectedTask.output ?? ""}
                    cwd={selectedTaskProject?.workspaceRoot}
                    className="px-3 py-2 text-lg leading-8 text-foreground"
                    lineBreaks
                  />
                </DetailSidebarSection>
              ) : null}
            </main>
            <DetailColumn stacked={panel}>
              <DetailSidebarSection title="Details">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow
                    label="Title"
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
                        aria-label="Task title"
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
                    label="Status"
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
                          aria-label="Task status"
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
                      label="For"
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
                              toastAudienceMoved(audience, task.title, () =>
                                audience === "person"
                                  ? props.onOpenInPlanner?.(task.environmentId, task.id)
                                  : selectTaskKey(taskKey(task)),
                              );
                            });
                          }}
                        >
                          <SelectTrigger
                            className={DETAIL_SELECT_TRIGGER_CLASS}
                            style={{ color: "var(--foreground)" }}
                            variant="ghost"
                            aria-label="For"
                            disabled={updatingField === "audience"}
                          >
                            <SelectValue>{AUDIENCE_LABELS[selectedTask.audience]}</SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="agent">{AUDIENCE_LABELS.agent}</SelectItem>
                            <SelectItem value="person">{AUDIENCE_LABELS.person}</SelectItem>
                          </SelectPopup>
                        </Select>
                      ) : (
                        AUDIENCE_LABELS[selectedTask.audience]
                      )}
                    </DetailSidebarRow>
                  )}
                  <DetailSidebarRow label="ID">
                    <button
                      type="button"
                      className="max-w-full truncate font-mono text-xs hover:underline"
                      title="Copy task ID"
                      onClick={() => {
                        void navigator.clipboard.writeText(selectedTask.id).then(
                          () => toastManager.add({ type: "success", title: "Task ID copied" }),
                          () =>
                            toastManager.add({ type: "error", title: "Could not copy task ID" }),
                        );
                      }}
                    >
                      {selectedTask.id}
                    </button>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Project">
                    <span className="flex min-w-0 items-center justify-end gap-2 text-foreground">
                      {selectedTaskProject ? (
                        <ProjectFavicon project={selectedTaskProject.favicon} className="size-4" />
                      ) : null}
                      <span className="truncate">{selectedTask.projectName ?? "No project"}</span>
                    </span>
                  </DetailSidebarRow>
                  {/* A person task's tags stay hidden; the planner hands it to an agent. */}
                  {selectedTask.audience === "person" ? null : (
                    <DetailSidebarRow label="Tags">
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
                        "None"
                      )}
                    </DetailSidebarRow>
                  )}
                  <DetailSidebarRow label="Created">
                    {new Date(selectedTask.createdAt).toLocaleDateString()}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Updated">
                    {new Date(selectedTask.updatedAt).toLocaleDateString()}
                  </DetailSidebarRow>
                  {selectedTask.archivedAt ? (
                    <DetailSidebarRow label="Archived">
                      {new Date(selectedTask.archivedAt).toLocaleString()}
                    </DetailSidebarRow>
                  ) : null}
                  {selectedTask.notBefore ? (
                    <DetailSidebarRow label="Not before">
                      {new Date(selectedTask.notBefore).toLocaleString()}
                    </DetailSidebarRow>
                  ) : null}
                </dl>
              </DetailSidebarSection>
              {selectedTask.sourceThreadId ? (
                <DetailSidebarSection title="Source thread">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <TaskThreadLink
                      environmentId={selectedTask.environmentId}
                      threadId={selectedTask.sourceThreadId as ThreadId}
                      title="Source thread"
                      onOpen={props.onOpenThread}
                    />
                  </div>
                </DetailSidebarSection>
              ) : null}
              <DetailSidebarSection title="Active runs" count={activeRuns.length}>
                {activeRuns.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {detailRunsStatus === "loading"
                      ? "Loading active runs…"
                      : detailRunsStatus === "error"
                        ? "Could not refresh active runs."
                        : "No active runs."}
                  </p>
                ) : (
                  activeRuns.map((run) => {
                    const { agentName, modelLabel } = getTaskRunAgentPresentation(
                      run,
                      props.agents,
                      props.providerEntriesByEnvironment.get(run.environmentId),
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
              <DetailSidebarSection title="Runs" count={detailRuns.length}>
                {runFilter !== ALL_FILTER ? (
                  <div className="flex items-center justify-between px-2 py-2 text-sm">
                    <span>{taskRunPresentation(runFilter, false)?.label}</span>
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => setRunFilter(ALL_FILTER)}
                    >
                      Show all runs
                    </button>
                  </div>
                ) : null}
                {detailRunsStatus === "error" ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
                    Could not refresh this task&apos;s worker runs. Showing cached results.
                  </div>
                ) : null}
                {detailRunsStatus === "loading" && taskThreads.length === 0 ? (
                  <div className="px-2 py-5 text-sm text-muted-foreground">
                    Loading worker runs...
                  </div>
                ) : taskThreads.length === 0 ? (
                  <div className="px-2 py-5 text-sm text-muted-foreground">
                    {runFilter === ALL_FILTER
                      ? "No worker has worked on this task yet."
                      : "No runs match this status."}
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {taskThreads.map((run) => {
                      const { agentName, modelLabel } = getTaskRunAgentPresentation(
                        run,
                        props.agents,
                        props.providerEntriesByEnvironment.get(run.environmentId),
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
                    Load more runs
                  </button>
                ) : null}
              </DetailSidebarSection>
              <DetailSidebarSection title="History" count={historyEntries.length}>
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
                placeholder="Description…"
                ariaLabel="Task description"
                className={DESCRIPTION_EDITOR_CLASS}
                onChange={(description) => setForm((current) => ({ ...current, description }))}
              />
            </main>
            <DetailColumn stacked={panel}>
              <DetailSidebarSection title="Details">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label="Title" controlSelector="input">
                    <input
                      autoFocus
                      className={DETAIL_INPUT_CLASS}
                      value={form.title}
                      placeholder="Task title…"
                      aria-label="Task title"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Project" controlSelector="button">
                    <Select
                      value={selectedProjectKey(form)}
                      onValueChange={(value) => {
                        const project = mutableProjects.find(
                          (candidate) => projectKey(candidate) === value,
                        );
                        if (project)
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
                        aria-label="Task project"
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
                            "Select project"
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {mutableProjects.map((project) => (
                          <SelectItem key={projectKey(project)} value={projectKey(project)}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Status" controlSelector="input">
                    <input
                      className={DETAIL_INPUT_CLASS}
                      value={form.status}
                      placeholder="new"
                      aria-label="Task status"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, status: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Tags">
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
            <div className={cards ? `flex flex-col ${LIST_CLASS}` : "contents"}>
              <div
                className={
                  cards
                    ? "flex flex-col gap-3 pr-(--workspace-gutter-end) pb-2 pl-(--workspace-gutter-start) empty:hidden"
                    : "contents"
                }
              >
                {environmentCount > 1 ? (
                  <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                    Task order is global within each connected environment. Environments are grouped
                    deterministically, and tasks cannot be dragged across that storage boundary.
                  </div>
                ) : null}
                {hasReadOnlyProjects ? (
                  <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                    Existing tasks from unavailable or expired extensions remain readable. Mutation
                    controls are hidden for those environments.
                  </div>
                ) : null}
                {selectedTaskKey ? (
                  <p className="text-sm text-muted-foreground">{detailError ?? "Loading task…"}</p>
                ) : null}
                {props.status === "error" ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
                    Up.computer couldn't load your tasks. {props.errorMessage ?? "Try again."}
                    <button type="button" className="ml-3 underline" onClick={props.onReload}>
                      Retry
                    </button>
                  </div>
                ) : props.status === "offline" && props.tasks.length > 0 ? (
                  <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                    {TASKS_OFFLINE_TEXT}
                  </div>
                ) : null}
              </div>

              {props.tasks.length === 0 ? (
                <div
                  className={`${cards ? "mr-(--workspace-gutter-end) ml-(--workspace-gutter-start) " : ""}rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground`}
                >
                  {props.status === "loading"
                    ? "Loading tasks..."
                    : props.status === "offline"
                      ? TASKS_OFFLINE_TEXT
                      : projectFilter !== null ||
                          statusFilter !== ALL_FILTER ||
                          filters.tags.length > 0 ||
                          archiveFilter !== "active"
                        ? "No tasks match the current filters."
                        : "No tasks yet"}
                </div>
              ) : filteredTasks.length === 0 ? (
                <div
                  className={`${cards ? "mr-(--workspace-gutter-end) ml-(--workspace-gutter-start) " : ""}rounded-lg border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground`}
                >
                  No tasks match the current filters.
                </div>
              ) : cards ? (
                <div className="flex min-w-0 flex-col">
                  {filteredTasks.map((task) => (
                    <TaskCard
                      key={taskKey(task)}
                      task={task}
                      projects={plannerProjectsByEnvironment.get(task.environmentId) ?? []}
                      statuses={
                        statusOptions.includes(task.status)
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
                      onProjectChange={(projectId) =>
                        void updateTaskInline(task, "project", {
                          projectId: projectId as ProjectId,
                        })
                      }
                      onStatusChange={(status) => void updateTaskInline(task, "status", { status })}
                      onArchivedChange={(archived) => void setTaskArchived(task, archived)}
                      onDrop={() => dropOn(task)}
                    />
                  ))}
                </div>
              ) : (
                <div className="min-w-0 overflow-x-auto">
                  {/* Auto layout: Runs (w-px) is as narrow as its numbers, and Title (max-w-0) truncates
                  and takes the width the other columns leave. */}
                  <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                    <thead className="border-b border-border text-muted-foreground">
                      <tr>
                        <th className="w-12 py-3 pr-2 font-medium">
                          <span className="sr-only">Order</span>
                        </th>
                        {showProjectColumn ? <ProjectIconHeader /> : null}
                        <th className="max-w-0 py-3 pr-4 font-medium">Title</th>
                        <th className="w-40 px-4 py-3 font-medium">Status</th>
                        <th className="w-56 px-4 py-3 font-medium">Tags</th>
                        <th className="w-px py-3 pl-4 text-right font-medium whitespace-nowrap">
                          Runs
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => {
                        const taskProject = projectsByKey.get(taskProjectKey(task)) ?? null;
                        return (
                          <tr
                            key={taskKey(task)}
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
                              <ProjectIconCell
                                project={taskProject?.favicon ?? null}
                                name={task.projectName}
                              />
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
                              {taskMetadataLabel(task) ? (
                                <div className="truncate text-muted-foreground">
                                  {taskMetadataLabel(task)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-4 align-middle whitespace-nowrap">
                              {task.status}
                              {task.archivedAt ? (
                                <span className="ml-2 text-muted-foreground">Archived</span>
                              ) : null}
                            </td>
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
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {props.hasMore ? (
                cards ? (
                  <div className="flex justify-center py-4">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.loadingMore}
                      onClick={props.onLoadMore}
                    >
                      {props.loadingMore ? "Loading…" : "Load more tasks"}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={props.loadingMore}
                    className="self-center rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    onClick={props.onLoadMore}
                  >
                    {props.loadingMore ? "Loading…" : "Load more tasks"}
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
