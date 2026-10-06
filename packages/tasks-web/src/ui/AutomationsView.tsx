/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  DEFAULT_AUTOMATION_TASK_STATUS,
  type TaskAutomationCatchUpPolicy,
  type TaskAutomationStatus,
} from "@t3tools/tasks-contracts/v1";

import type { TasksWebRpcClient } from "../rpc/index.ts";
import type { ScopedTask, ScopedTaskAutomation, ScopedTaskAutomationRun } from "../state/index.ts";
import { stackedThreadToast, toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { ProjectFavicon } from "../../../../apps/web/src/components/ProjectFavicon.tsx";
import { formatRelativeTimeLabel } from "../../../../apps/web/src/timestampFormat.ts";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { Switch } from "../../../../apps/web/src/components/ui/switch.tsx";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "../../../../apps/web/src/components/ui/popover.tsx";
import { Toggle } from "../../../../apps/web/src/components/ui/toggle.tsx";

import {
  DETAIL_INPUT_CLASS,
  DETAIL_SELECT_TRIGGER_CLASS,
  DetailSidebarRow,
  DetailSidebarSection,
} from "./DetailSidebar.tsx";
import { WorkspaceViewLayout } from "./WorkspaceViewLayout.tsx";
import { SHOW_MANUAL_CREATE_ACTIONS } from "./manualCreation.ts";
import {
  filterByProjectFilter,
  orderedProjectFilterKeys,
  preferredProject,
  type ViewProjectFilter,
} from "./projectFilter.ts";
import {
  WEEKDAYS,
  calendarScheduleFromCron,
  calendarScheduleToCron,
  describeCalendarSchedule,
  describeCron,
  type CalendarSchedule,
  type CalendarScheduleMode,
} from "./automationCalendarSchedule.ts";
import { ProjectIconCell, ProjectIconHeader } from "./ProjectIconCell.tsx";
import { splitListInput, type TasksWebProject } from "./shared.ts";

const CATCH_UP_POLICIES: ReadonlyArray<{
  readonly value: TaskAutomationCatchUpPolicy;
  readonly label: string;
}> = [
  { value: "fire-once", label: "Run once after a missed window" },
  { value: "skip", label: "Skip missed windows entirely" },
];

const SCHEDULE_MODES: ReadonlyArray<{
  readonly value: CalendarScheduleMode;
  readonly label: string;
}> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

export interface AutomationsViewProps {
  readonly projects: readonly TasksWebProject[];
  readonly automations: readonly ScopedTaskAutomation[];
  /**
   * The header's shared project choice: the list shows only its automations.
   * Deep links still resolve automations outside the filter.
   */
  readonly projectFilter?: ViewProjectFilter | null;
  /** The shared project select, shown at the right of the header. */
  readonly projectSelect?: ReactNode;
  readonly tasks: readonly ScopedTask[];
  readonly runs: readonly ScopedTaskAutomationRun[];
  readonly status: "loading" | "ready" | "error";
  readonly errorMessage?: string;
  readonly initialSelectedAutomationKey?: string;
  readonly canMutateEnvironment: (environmentId: EnvironmentId) => boolean;
  readonly getClient: (environmentId: EnvironmentId) => TasksWebRpcClient | null;
  readonly onReload: () => void;
  readonly onNavigateBack: () => void;
  readonly onSelectedAutomationKeyChange?: (automationKey: string | null) => void;
  readonly onOpenTask: (environmentId: EnvironmentId, taskId: string) => void;
}

type AutomationViewMode =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly automation: ScopedTaskAutomation };

interface AutomationFormState {
  readonly name: string;
  readonly projectKey: string;
  readonly schedule: CalendarSchedule;
  readonly timezone: string;
  readonly title: string;
  readonly description: string;
  readonly taskStatus: string;
  // Priority stays hidden by product design, but retaining it prevents unrelated edits from
  // clearing a value already stored on an existing automation.
  readonly priority: string;
  readonly tags: string;
  readonly catchUpPolicy: TaskAutomationCatchUpPolicy;
  readonly skipIfOpen: boolean;
}

function projectKey(project: Pick<TasksWebProject, "environmentId" | "id">): string {
  return `${project.environmentId}:${project.id}`;
}

function automationKey(automation: Pick<ScopedTaskAutomation, "environmentId" | "id">): string {
  return `${automation.environmentId}:${automation.id}`;
}

function hostTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function emptyForm(project?: TasksWebProject): AutomationFormState {
  return {
    name: "",
    projectKey: project ? projectKey(project) : "",
    schedule: calendarScheduleFromCron("0 9 * * 1-5"),
    timezone: hostTimezone(),
    title: "",
    description: "",
    taskStatus: DEFAULT_AUTOMATION_TASK_STATUS,
    priority: "",
    tags: "",
    catchUpPolicy: "fire-once",
    skipIfOpen: true,
  };
}

function automationForm(automation: ScopedTaskAutomation): AutomationFormState {
  return {
    name: automation.name,
    projectKey: `${automation.environmentId}:${automation.projectId}`,
    schedule: calendarScheduleFromCron(automation.schedule.cron),
    timezone: automation.schedule.timezone,
    title: automation.template.title,
    description: automation.template.description,
    taskStatus: automation.template.status,
    priority: automation.template.priority ?? "",
    tags: automation.template.tags.join(", "),
    catchUpPolicy: automation.catchUpPolicy,
    skipIfOpen: automation.skipIfOpen,
  };
}

function automationScheduleError(form: AutomationFormState): string | null {
  if (!form.timezone.trim()) return "Enter a time zone.";
  if (form.schedule.mode === "weekly" && form.schedule.weekdays.length === 0) {
    return "Choose at least one day.";
  }
  if (calendarScheduleToCron(form.schedule) !== null) return null;
  return form.schedule.mode === "custom"
    ? "Enter a valid 5- or 6-field cron expression."
    : "Enter a valid schedule.";
}

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function taskAutomationId(task: ScopedTask): string | null {
  if (!task.metadata || typeof task.metadata !== "object" || Array.isArray(task.metadata))
    return null;
  const value = (task.metadata as Record<string, unknown>).automationId;
  return typeof value === "string" ? value : null;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function formatListTimestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const today = new Date();
  const isToday =
    parsed.getFullYear() === today.getFullYear() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getDate() === today.getDate();
  if (isToday) {
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return parsed.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(parsed.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function AutomationsView(props: AutomationsViewProps) {
  const [viewMode, setViewMode] = useState<AutomationViewMode | null>(null);
  const [schedulePopoverOpen, setSchedulePopoverOpen] = useState(false);
  const scheduleSnapshotRef = useRef<AutomationFormState | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationCountRef = useRef(0);
  const createInFlightRef = useRef(false);
  const enqueueMutation = useCallback(async (key: string, mutation: () => Promise<void>) => {
    pendingMutationCountRef.current += 1;
    setSavingKey(key);
    const result = mutationQueueRef.current.then(mutation);
    mutationQueueRef.current = result.catch(() => undefined);
    try {
      await result;
    } finally {
      pendingMutationCountRef.current -= 1;
      if (pendingMutationCountRef.current === 0) setSavingKey(null);
    }
  }, []);
  const [detailStatus, setDetailStatus] = useState<TaskAutomationStatus>("disabled");
  const mutableProjects = useMemo(
    () => props.projects.filter((project) => props.canMutateEnvironment(project.environmentId)),
    [props],
  );
  const projectsByKey = useMemo(
    () => new Map(props.projects.map((project) => [projectKey(project), project] as const)),
    [props.projects],
  );
  const [form, setForm] = useState<AutomationFormState>(() => emptyForm(mutableProjects[0]));
  const formRef = useRef(form);
  formRef.current = form;
  const editTarget = viewMode?.kind === "edit" ? viewMode.automation : null;
  const isCreateMode = viewMode?.kind === "create";
  const editingAutomation = editTarget
    ? (props.automations.find(
        (automation) =>
          automation.environmentId === editTarget.environmentId && automation.id === editTarget.id,
      ) ?? editTarget)
    : null;
  const selectedProject = mutableProjects.find(
    (project) => projectKey(project) === form.projectKey,
  );
  const createScheduleError = isCreateMode ? automationScheduleError(form) : null;
  const projectFilter = props.projectFilter ?? null;
  const visibleAutomations = useMemo(
    () => filterByProjectFilter(props.automations, projectFilter),
    [projectFilter, props.automations],
  );
  const drafts = visibleAutomations.filter((automation) => automation.status === "draft");
  const lastRunByAutomation = useMemo(() => {
    const result = new Map<string, ScopedTaskAutomationRun>();
    // Runs arrive newest-first, so the first entry per automation wins.
    for (const run of props.runs) {
      const key = `${run.environmentId}:${run.automationId}`;
      if (!result.has(key)) result.set(key, run);
    }
    return result;
  }, [props.runs]);
  const automationRuns = useMemo(
    () =>
      editingAutomation
        ? props.runs.filter(
            (run) =>
              run.environmentId === editingAutomation.environmentId &&
              run.automationId === editingAutomation.id,
          )
        : [],
    [editingAutomation, props.runs],
  );
  const automationTasks = useMemo(() => {
    if (!editingAutomation) return [];
    const runTaskIds = new Set(
      automationRuns.flatMap((run) => (run.taskId === null ? [] : [run.taskId])),
    );
    return props.tasks.filter(
      (task) =>
        task.environmentId === editingAutomation.environmentId &&
        (taskAutomationId(task) === editingAutomation.id || runTaskIds.has(task.id)),
    );
  }, [automationRuns, editingAutomation, props.tasks]);
  const editingAutomationProject = editingAutomation
    ? (projectsByKey.get(`${editingAutomation.environmentId}:${editingAutomation.projectId}`) ??
      null)
    : null;
  const canEditAutomation = Boolean(
    editingAutomation && props.canMutateEnvironment(editingAutomation.environmentId),
  );

  const openCreate = useCallback(() => {
    setForm(emptyForm(preferredProject(mutableProjects, orderedProjectFilterKeys(projectFilter))));
    setViewMode({ kind: "create" });
  }, [mutableProjects, projectFilter]);

  const showAutomation = useCallback((automation: ScopedTaskAutomation) => {
    setForm(automationForm(automation));
    setDetailStatus(automation.status);
    setViewMode({ kind: "edit", automation });
  }, []);

  const openEdit = useCallback(
    (automation: ScopedTaskAutomation) => {
      if (props.onSelectedAutomationKeyChange) {
        props.onSelectedAutomationKeyChange(automationKey(automation));
        return;
      }
      showAutomation(automation);
    },
    [props.onSelectedAutomationKeyChange, showAutomation],
  );

  useEffect(() => {
    const selectedKey = props.initialSelectedAutomationKey;
    if (!selectedKey) {
      if (viewMode?.kind === "edit") setViewMode(null);
      return;
    }
    const automation = props.automations.find(
      (candidate) => automationKey(candidate) === selectedKey,
    );
    if (!automation) {
      if (props.status === "ready") {
        if (viewMode?.kind === "edit") setViewMode(null);
        props.onSelectedAutomationKeyChange?.(null);
      }
      return;
    }
    if (editingAutomation && automationKey(editingAutomation) === selectedKey) return;
    showAutomation(automation);
  }, [
    editingAutomation,
    props.automations,
    props.initialSelectedAutomationKey,
    props.onSelectedAutomationKeyChange,
    props.status,
    showAutomation,
    viewMode?.kind,
  ]);

  const save = useCallback(
    async (draft: AutomationFormState = form) => {
      const creating = !editingAutomation;
      if (creating && createInFlightRef.current) return;
      const name = draft.name.trim();
      const title = draft.title.trim();
      const cron = calendarScheduleToCron(draft.schedule);
      const timezone = draft.timezone.trim();
      const scheduleError = automationScheduleError(draft);
      const target = editingAutomation
        ? { environmentId: editingAutomation.environmentId, id: editingAutomation.projectId }
        : selectedProject
          ? { environmentId: selectedProject.environmentId, id: selectedProject.id }
          : null;
      if (!target || !name || !title || !cron || !timezone || scheduleError) {
        toastManager.add({
          type: "error",
          title: !target
            ? "Select a project"
            : !name
              ? "Automation name is required"
              : !title
                ? "Task title is required"
                : (scheduleError ?? "Enter a valid schedule"),
        });
        return;
      }
      const client = props.getClient(target.environmentId);
      if (!client) {
        toastManager.add({ type: "error", title: "Automations API unavailable" });
        return;
      }
      if (creating) createInFlightRef.current = true;
      try {
        await enqueueMutation(editingAutomation ? editingAutomation.id : "create", async () => {
          await client.automations.upsert({
            ...(editingAutomation ? { id: editingAutomation.id } : {}),
            projectId: target.id,
            name,
            // Editing never silently activates: an existing automation keeps its
            // status, and a new one starts paused until the user turns it on.
            status: editingAutomation ? detailStatus : "disabled",
            schedule: { cron, timezone },
            template: {
              title,
              description: draft.description,
              status: draft.taskStatus.trim() || DEFAULT_AUTOMATION_TASK_STATUS,
              priority: draft.priority.trim() || null,
              tags: splitListInput(draft.tags),
            },
            catchUpPolicy: draft.catchUpPolicy,
            skipIfOpen: draft.skipIfOpen,
          });
        });
        if (!editingAutomation) {
          toastManager.add({
            type: "success",
            title: "Automation created",
            description: `${name} is paused until you enable it.`,
          });
          setViewMode(null);
        }
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: editingAutomation
              ? "Failed to update automation"
              : "Failed to create automation",
            description: errorDescription(error),
          }),
        );
      } finally {
        if (creating) createInFlightRef.current = false;
      }
    },
    [detailStatus, editingAutomation, enqueueMutation, form, props, selectedProject],
  );

  const commitForm = useCallback(
    (next: AutomationFormState) => {
      setForm(next);
      void save(next);
    },
    [save],
  );

  const handleSchedulePopoverOpenChange = useCallback(
    (open: boolean) => {
      setSchedulePopoverOpen(open);
      if (open) {
        scheduleSnapshotRef.current = formRef.current;
        return;
      }
      const snapshot = scheduleSnapshotRef.current;
      scheduleSnapshotRef.current = null;
      if (!snapshot) return;
      const current = formRef.current;
      const scheduleIsValid =
        calendarScheduleToCron(current.schedule) !== null && current.timezone.trim().length > 0;
      if (!scheduleIsValid) {
        setForm(snapshot);
        return;
      }
      const changed =
        JSON.stringify(current.schedule) !== JSON.stringify(snapshot.schedule) ||
        current.timezone !== snapshot.timezone;
      if (changed) commitForm(current);
    },
    [commitForm],
  );

  const setStatus = useCallback(
    async (automation: ScopedTaskAutomation, status: TaskAutomationStatus) => {
      const client = props.getClient(automation.environmentId);
      if (!client) return;
      setDetailStatus(status);
      try {
        await enqueueMutation(automation.id, async () => {
          await client.automations.setStatus({ id: automation.id, status });
        });
        toastManager.add({
          type: "success",
          title: status === "enabled" ? "Automation enabled" : "Automation paused",
          description: automation.name,
        });
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update automation",
            description: errorDescription(error),
          }),
        );
      }
    },
    [enqueueMutation, props],
  );

  const remove = useCallback(
    async (automation: ScopedTaskAutomation) => {
      const client = props.getClient(automation.environmentId);
      if (!client) return;
      try {
        await enqueueMutation(automation.id, async () => {
          await client.automations.delete({ id: automation.id });
        });
        toastManager.add({
          type: "success",
          title: "Automation deleted",
          description: automation.name,
        });
        props.onReload();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete automation",
            description: errorDescription(error),
          }),
        );
      }
    },
    [enqueueMutation, props],
  );

  return (
    <WorkspaceViewLayout
      title={editingAutomation ? "" : isCreateMode ? "New automation" : "Automations"}
      action={
        editingAutomation
          ? undefined
          : isCreateMode
            ? {
                ariaLabel: "Create automation",
                disabled: mutableProjects.length === 0 || savingKey !== null,
                hideIcon: true,
                label: "Create",
                onClick: () => {
                  void save();
                },
              }
            : SHOW_MANUAL_CREATE_ACTIONS
              ? {
                  ariaLabel: "Create automation",
                  disabled: mutableProjects.length === 0 || savingKey !== null,
                  onClick: openCreate,
                }
              : undefined
      }
      leadingAction={
        editingAutomation || isCreateMode
          ? {
              ariaLabel: editingAutomation ? "Back to automations" : "Cancel automation creation",
              disabled: isCreateMode && savingKey !== null,
              icon: <ArrowLeftIcon className="size-4" />,
              onClick: editingAutomation
                ? props.onNavigateBack
                : () => {
                    if (!createInFlightRef.current) setViewMode(null);
                  },
            }
          : undefined
      }
      toolbar={
        editingAutomation ? (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {editingAutomation.name}
            </span>
            {/* Base UI's Switch is a span, which the header's drag region would
                otherwise swallow in Electron. */}
            <span className="flex shrink-0 [-webkit-app-region:no-drag]">
              <Switch
                checked={detailStatus === "enabled"}
                disabled={!canEditAutomation}
                aria-label={`${detailStatus === "enabled" ? "Pause" : "Enable"} ${editingAutomation.name}`}
                onCheckedChange={(checked) => {
                  const nextStatus = checked ? "enabled" : "disabled";
                  if (nextStatus !== detailStatus) void setStatus(editingAutomation, nextStatus);
                }}
              />
            </span>
          </>
        ) : isCreateMode ? undefined : (
          <>
            <span className="min-w-0 flex-1" />
            {props.projectSelect}
          </>
        )
      }
      onNavigateBack={
        editingAutomation
          ? props.onNavigateBack
          : isCreateMode
            ? () => {
                if (!createInFlightRef.current) setViewMode(null);
              }
            : props.onNavigateBack
      }
    >
      {editingAutomation ? (
        <div className="flex min-h-0 w-full flex-1 py-5">
          <div className="flex min-h-0 min-w-0 flex-1 gap-5">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              {canEditAutomation ? (
                <textarea
                  className="min-h-36 w-full flex-1 resize-none appearance-none overflow-auto border-0 bg-transparent px-3 py-2 text-lg leading-8 text-foreground outline-none placeholder:text-muted-foreground focus:bg-transparent focus:outline-none [&::-webkit-resizer]:hidden"
                  value={form.description}
                  placeholder="Task description…"
                  aria-label="Automation task description"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  onBlur={() => {
                    if (form.description !== editingAutomation.template.description)
                      commitForm(form);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setForm((current) => ({
                        ...current,
                        description: editingAutomation.template.description,
                      }));
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : editingAutomation.template.description ? (
                <p className="min-h-0 flex-1 whitespace-pre-wrap px-3 py-2 text-lg leading-8 text-foreground">
                  {editingAutomation.template.description}
                </p>
              ) : (
                <p className="min-h-0 flex-1 px-3 py-2 text-sm text-muted-foreground">
                  No description.
                </p>
              )}
            </main>
            <aside
              className="min-h-0 shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground"
              style={{ width: 380 }}
            >
              <DetailSidebarSection title="Details">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow
                    label="Name"
                    controlSelector={canEditAutomation ? "input" : undefined}
                  >
                    {canEditAutomation ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.name}
                        aria-label="Automation name"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, name: event.target.value }))
                        }
                        onBlur={() => {
                          const name = form.name.trim();
                          if (name && name !== editingAutomation.name)
                            commitForm({ ...form, name });
                          else if (!name)
                            setForm((current) => ({ ...current, name: editingAutomation.name }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            setForm((current) => ({ ...current, name: editingAutomation.name }));
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      editingAutomation.name
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow
                    label="Task title"
                    controlSelector={canEditAutomation ? "input" : undefined}
                  >
                    {canEditAutomation ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.title}
                        aria-label="Automation task title"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, title: event.target.value }))
                        }
                        onBlur={() => {
                          const title = form.title.trim();
                          if (title && title !== editingAutomation.template.title)
                            commitForm({ ...form, title });
                          else if (!title)
                            setForm((current) => ({
                              ...current,
                              title: editingAutomation.template.title,
                            }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            setForm((current) => ({
                              ...current,
                              title: editingAutomation.template.title,
                            }));
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      editingAutomation.template.title
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Project">
                    <span className="flex min-w-0 items-center justify-end gap-2">
                      {editingAutomationProject ? (
                        <ProjectFavicon
                          project={editingAutomationProject.favicon}
                          className="size-4 shrink-0"
                        />
                      ) : null}
                      <span className="truncate">
                        {editingAutomation.projectName ?? "Unknown project"}
                      </span>
                    </span>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Task status">
                    {canEditAutomation ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.taskStatus}
                        aria-label="Created task status"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, taskStatus: event.target.value }))
                        }
                        onBlur={() => {
                          if (form.taskStatus.trim() !== editingAutomation.template.status)
                            commitForm(form);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : (
                      editingAutomation.template.status
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Tags">
                    {canEditAutomation ? (
                      <input
                        className={DETAIL_INPUT_CLASS}
                        value={form.tags}
                        placeholder="No tags"
                        aria-label="Created task tags"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, tags: event.target.value }))
                        }
                        onBlur={() => {
                          if (form.tags !== editingAutomation.template.tags.join(", "))
                            commitForm(form);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : editingAutomation.template.tags.length ? (
                      editingAutomation.template.tags.join(", ")
                    ) : (
                      "—"
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Schedule">
                    {canEditAutomation ? (
                      <Popover
                        open={schedulePopoverOpen}
                        onOpenChange={handleSchedulePopoverOpenChange}
                      >
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              className="h-8 min-w-0 max-w-full truncate bg-transparent p-0 text-right text-sm text-foreground outline-none"
                              title="Edit schedule"
                            />
                          }
                        >
                          {describeCalendarSchedule(form.schedule)}
                        </PopoverTrigger>
                        <PopoverPopup
                          side="bottom"
                          align="end"
                          className="w-[360px] max-w-[calc(100vw-24px)]"
                          padding="compact"
                        >
                          <div className="flex flex-col gap-3">
                            <Select
                              value={form.schedule.mode}
                              onValueChange={(value) => {
                                const next = {
                                  ...form,
                                  schedule: {
                                    ...form.schedule,
                                    mode: (value ?? "weekly") as CalendarScheduleMode,
                                  },
                                };
                                setForm(next);
                              }}
                            >
                              <SelectTrigger
                                className="h-9 w-full border-border/70 bg-transparent px-3 text-sm"
                                aria-label="Frequency"
                              >
                                <SelectValue>
                                  {
                                    SCHEDULE_MODES.find(({ value }) => value === form.schedule.mode)
                                      ?.label
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectPopup>
                                {SCHEDULE_MODES.map((mode) => (
                                  <SelectItem key={mode.value} value={mode.value}>
                                    {mode.label}
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </Select>
                            {form.schedule.mode === "weekly" ? (
                              <div className="flex gap-1.5">
                                {WEEKDAYS.map((day) => {
                                  const selected = form.schedule.weekdays.includes(day.value);
                                  return (
                                    <Toggle
                                      key={day.value}
                                      variant="outline"
                                      pressed={selected}
                                      aria-label={day.label}
                                      className="h-9 min-w-0 flex-1 px-1 text-sm"
                                      onPressedChange={() => {
                                        const weekdays = selected
                                          ? form.schedule.weekdays.filter(
                                              (value) => value !== day.value,
                                            )
                                          : [...form.schedule.weekdays, day.value];
                                        const next = {
                                          ...form,
                                          schedule: { ...form.schedule, weekdays },
                                        };
                                        setForm(next);
                                      }}
                                    >
                                      {day.shortLabel}
                                    </Toggle>
                                  );
                                })}
                              </div>
                            ) : null}
                            {form.schedule.mode === "monthly" ? (
                              <Select
                                value={String(form.schedule.monthDay)}
                                onValueChange={(value) =>
                                  setForm({
                                    ...form,
                                    schedule: { ...form.schedule, monthDay: Number(value ?? 1) },
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="h-9 w-full border-border/70 bg-transparent px-3 text-sm"
                                  aria-label="Day of month"
                                >
                                  <SelectValue>Day {form.schedule.monthDay}</SelectValue>
                                </SelectTrigger>
                                <SelectPopup className="max-h-64">
                                  {MONTH_DAYS.map((day) => (
                                    <SelectItem key={day} value={String(day)}>
                                      {day}
                                    </SelectItem>
                                  ))}
                                </SelectPopup>
                              </Select>
                            ) : null}
                            {form.schedule.mode === "custom" ? (
                              <input
                                className="h-9 w-full rounded-md border border-border/70 bg-transparent px-3 font-mono text-sm text-foreground outline-none"
                                value={form.schedule.customCron}
                                aria-label="Cron expression"
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    schedule: {
                                      ...current.schedule,
                                      customCron: event.target.value,
                                    },
                                  }))
                                }
                              />
                            ) : (
                              <input
                                type="time"
                                className="h-9 w-full rounded-md border border-border/70 bg-transparent px-3 text-sm text-foreground outline-none"
                                value={form.schedule.time}
                                aria-label="Schedule time"
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    schedule: { ...current.schedule, time: event.target.value },
                                  }))
                                }
                              />
                            )}
                            <input
                              className="h-9 w-full rounded-md border border-border/70 bg-transparent px-3 text-sm text-foreground outline-none"
                              value={form.timezone}
                              aria-label="Time zone"
                              onChange={(event) =>
                                setForm((current) => ({ ...current, timezone: event.target.value }))
                              }
                            />
                          </div>
                        </PopoverPopup>
                      </Popover>
                    ) : (
                      describeCalendarSchedule(form.schedule)
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Missed run">
                    {canEditAutomation ? (
                      <Select
                        value={form.catchUpPolicy}
                        onValueChange={(value) =>
                          commitForm({
                            ...form,
                            catchUpPolicy: (value ?? "fire-once") as TaskAutomationCatchUpPolicy,
                          })
                        }
                      >
                        <SelectTrigger
                          className={DETAIL_SELECT_TRIGGER_CLASS}
                          variant="ghost"
                          aria-label="Missed run policy"
                        >
                          <SelectValue>
                            {
                              CATCH_UP_POLICIES.find(({ value }) => value === form.catchUpPolicy)
                                ?.label
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {CATCH_UP_POLICIES.map((policy) => (
                            <SelectItem key={policy.value} value={policy.value}>
                              {policy.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : (
                      CATCH_UP_POLICIES.find(({ value }) => value === form.catchUpPolicy)?.label
                    )}
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Skip if open">
                    <Switch
                      checked={form.skipIfOpen}
                      disabled={!canEditAutomation}
                      aria-label="Skip while previous task is open"
                      onCheckedChange={(checked) =>
                        commitForm({ ...form, skipIfOpen: Boolean(checked) })
                      }
                    />
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
              <DetailSidebarSection title="Tasks" count={automationTasks.length}>
                <div className="flex flex-col gap-0.5">
                  {automationTasks.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">No created tasks yet.</p>
                  ) : (
                    automationTasks.map((task) => (
                      <DetailSidebarRow
                        key={`${task.environmentId}:${task.id}`}
                        label={task.title}
                        emphasizeLabel
                        interactive
                        onClick={() => props.onOpenTask(task.environmentId, task.id)}
                      >
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {formatRelativeTimeLabel(task.createdAt)}
                        </span>
                      </DetailSidebarRow>
                    ))
                  )}
                </div>
              </DetailSidebarSection>
              {editingAutomation.status === "draft" && canEditAutomation ? (
                <div className="px-2 pb-4">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingKey !== null}
                    onClick={() => {
                      setViewMode(null);
                      props.onSelectedAutomationKeyChange?.(null);
                      void remove(editingAutomation);
                    }}
                  >
                    Discard draft
                  </Button>
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      ) : isCreateMode ? (
        <div className="flex min-h-0 w-full flex-1 py-5">
          <div className="flex min-h-0 min-w-0 flex-1 gap-5">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <textarea
                className="min-h-36 w-full flex-1 resize-none appearance-none overflow-auto border-0 bg-transparent px-3 py-2 text-lg leading-8 text-foreground outline-none placeholder:text-muted-foreground focus:bg-transparent focus:outline-none [&::-webkit-resizer]:hidden"
                value={form.description}
                placeholder="Task description…"
                aria-label="Automation task description"
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </main>
            <aside
              className="min-h-0 shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground"
              style={{ width: 380 }}
            >
              <DetailSidebarSection title="Details">
                <dl className="flex min-w-0 flex-col gap-0.5">
                  <DetailSidebarRow label="Name" controlSelector="input">
                    <input
                      autoFocus
                      className={DETAIL_INPUT_CLASS}
                      value={form.name}
                      placeholder="Automation name…"
                      aria-label="Automation name"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Task title" controlSelector="input">
                    <input
                      className={DETAIL_INPUT_CLASS}
                      value={form.title}
                      placeholder="Task title…"
                      aria-label="Automation task title"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Project" controlSelector="button">
                    <Select
                      value={selectedProject ? projectKey(selectedProject) : ""}
                      onValueChange={(value) => {
                        const project = mutableProjects.find(
                          (candidate) => projectKey(candidate) === value,
                        );
                        if (project)
                          setForm((current) => ({ ...current, projectKey: projectKey(project) }));
                      }}
                    >
                      <SelectTrigger
                        className={DETAIL_SELECT_TRIGGER_CLASS}
                        variant="ghost"
                        aria-label="Automation project"
                      >
                        <SelectValue>
                          {selectedProject ? (
                            <span className="flex min-w-0 items-center justify-end gap-2">
                              <ProjectFavicon
                                project={selectedProject.favicon}
                                className="size-4 shrink-0"
                              />
                              <span className="truncate">{selectedProject.name}</span>
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
                  <DetailSidebarRow label="Task status" controlSelector="input">
                    <input
                      className={DETAIL_INPUT_CLASS}
                      value={form.taskStatus}
                      placeholder="new"
                      aria-label="Created task status"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, taskStatus: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Tags" controlSelector="input">
                    <input
                      className={DETAIL_INPUT_CLASS}
                      value={form.tags}
                      placeholder="No tags"
                      aria-label="Created task tags"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, tags: event.target.value }))
                      }
                    />
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Schedule">
                    <Popover open={schedulePopoverOpen} onOpenChange={setSchedulePopoverOpen}>
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            className="h-8 min-w-0 max-w-full truncate bg-transparent p-0 text-right text-sm text-foreground outline-none"
                            title="Edit schedule"
                          />
                        }
                      >
                        {createScheduleError
                          ? "Complete schedule"
                          : describeCalendarSchedule(form.schedule)}
                      </PopoverTrigger>
                      <PopoverPopup
                        side="bottom"
                        align="end"
                        className="w-[360px] max-w-[calc(100vw-24px)]"
                        padding="compact"
                      >
                        <div className="flex flex-col gap-3">
                          <Select
                            value={form.schedule.mode}
                            onValueChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                schedule: {
                                  ...current.schedule,
                                  mode: (value ?? "weekly") as CalendarScheduleMode,
                                },
                              }))
                            }
                          >
                            <SelectTrigger
                              className="h-9 w-full border-border/70 bg-transparent px-3 text-sm"
                              aria-label="Frequency"
                            >
                              <SelectValue>
                                {
                                  SCHEDULE_MODES.find(({ value }) => value === form.schedule.mode)
                                    ?.label
                                }
                              </SelectValue>
                            </SelectTrigger>
                            <SelectPopup>
                              {SCHEDULE_MODES.map((mode) => (
                                <SelectItem key={mode.value} value={mode.value}>
                                  {mode.label}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                          {form.schedule.mode === "weekly" ? (
                            <div className="flex gap-1.5">
                              {WEEKDAYS.map((day) => {
                                const selected = form.schedule.weekdays.includes(day.value);
                                return (
                                  <Toggle
                                    key={day.value}
                                    variant="outline"
                                    pressed={selected}
                                    aria-label={day.label}
                                    className="h-9 min-w-0 flex-1 px-1 text-sm"
                                    onPressedChange={() =>
                                      setForm((current) => ({
                                        ...current,
                                        schedule: {
                                          ...current.schedule,
                                          weekdays: selected
                                            ? current.schedule.weekdays.filter(
                                                (value) => value !== day.value,
                                              )
                                            : [...current.schedule.weekdays, day.value],
                                        },
                                      }))
                                    }
                                  >
                                    {day.shortLabel}
                                  </Toggle>
                                );
                              })}
                            </div>
                          ) : null}
                          {form.schedule.mode === "monthly" ? (
                            <Select
                              value={String(form.schedule.monthDay)}
                              onValueChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  schedule: { ...current.schedule, monthDay: Number(value ?? 1) },
                                }))
                              }
                            >
                              <SelectTrigger
                                className="h-9 w-full border-border/70 bg-transparent px-3 text-sm"
                                aria-label="Day of month"
                              >
                                <SelectValue>Day {form.schedule.monthDay}</SelectValue>
                              </SelectTrigger>
                              <SelectPopup className="max-h-64">
                                {MONTH_DAYS.map((day) => (
                                  <SelectItem key={day} value={String(day)}>
                                    {day}
                                  </SelectItem>
                                ))}
                              </SelectPopup>
                            </Select>
                          ) : null}
                          {form.schedule.mode === "custom" ? (
                            <input
                              aria-invalid={calendarScheduleToCron(form.schedule) === null}
                              className="h-9 w-full rounded-md border border-border/70 bg-transparent px-3 font-mono text-sm text-foreground outline-none"
                              value={form.schedule.customCron}
                              aria-label="Cron expression"
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  schedule: { ...current.schedule, customCron: event.target.value },
                                }))
                              }
                            />
                          ) : (
                            <input
                              type="time"
                              className="h-9 w-full rounded-md border border-border/70 bg-transparent px-3 text-sm text-foreground outline-none"
                              value={form.schedule.time}
                              aria-label="Schedule time"
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  schedule: { ...current.schedule, time: event.target.value },
                                }))
                              }
                            />
                          )}
                          <input
                            aria-invalid={!form.timezone.trim()}
                            className="h-9 w-full rounded-md border border-border/70 bg-transparent px-3 text-sm text-foreground outline-none"
                            value={form.timezone}
                            aria-label="Time zone"
                            onChange={(event) =>
                              setForm((current) => ({ ...current, timezone: event.target.value }))
                            }
                          />
                          {createScheduleError ? (
                            <p aria-live="polite" className="text-sm text-destructive">
                              {createScheduleError}
                            </p>
                          ) : null}
                        </div>
                      </PopoverPopup>
                    </Popover>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Missed run" controlSelector="button">
                    <Select
                      value={form.catchUpPolicy}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          catchUpPolicy: (value ?? "fire-once") as TaskAutomationCatchUpPolicy,
                        }))
                      }
                    >
                      <SelectTrigger
                        className={DETAIL_SELECT_TRIGGER_CLASS}
                        variant="ghost"
                        aria-label="Missed run policy"
                      >
                        <SelectValue>
                          {
                            CATCH_UP_POLICIES.find(({ value }) => value === form.catchUpPolicy)
                              ?.label
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {CATCH_UP_POLICIES.map((policy) => (
                          <SelectItem key={policy.value} value={policy.value}>
                            {policy.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </DetailSidebarRow>
                  <DetailSidebarRow label="Skip if open">
                    <Switch
                      checked={form.skipIfOpen}
                      aria-label="Skip while previous task is open"
                      onCheckedChange={(checked) =>
                        setForm((current) => ({ ...current, skipIfOpen: Boolean(checked) }))
                      }
                    />
                  </DetailSidebarRow>
                </dl>
              </DetailSidebarSection>
            </aside>
          </div>
        </div>
      ) : (
        <div className="flex w-full min-w-0 flex-col gap-5 py-6">
          {drafts.length > 0 ? (
            <div className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-sm text-foreground">
              {drafts.length === 1
                ? "1 automation is waiting for your review."
                : `${drafts.length} automations are waiting for your review.`}{" "}
              Drafts never run until you enable them.
            </div>
          ) : null}
          {props.status === "error" ? (
            <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
              {props.errorMessage ?? "Failed to load automations"}
            </div>
          ) : visibleAutomations.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {props.status === "loading"
                ? "Loading automations..."
                : projectFilter && props.automations.length > 0
                  ? `No automations for ${projectFilter.label}`
                  : "No automations yet. An automation creates a task on a schedule; your agents pick it up from there."}
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[1200px] table-fixed border-collapse text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    {projectFilter === null ? <ProjectIconHeader /> : null}
                    <th className="w-[24%] py-3 pr-4 font-medium">Name</th>
                    <th className="w-[20%] px-4 py-3 font-medium">Schedule</th>
                    <th className="px-4 py-3 font-medium">Creates</th>
                    <th className="w-32 px-4 py-3 font-medium">Last run</th>
                    <th className="w-28 px-4 py-3 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAutomations.map((automation) => {
                    const editable = props.canMutateEnvironment(automation.environmentId);
                    const automationProject =
                      projectsByKey.get(`${automation.environmentId}:${automation.projectId}`) ??
                      null;
                    const lastRun = lastRunByAutomation.get(
                      `${automation.environmentId}:${automation.id}`,
                    );
                    const scheduleLabel = `${describeCron(automation.schedule.cron)} · ${automation.schedule.timezone}`;
                    const createsLabel = `${automation.template.title}${automation.template.tags.length ? ` · ${automation.template.tags.join(", ")}` : ""}`;
                    return (
                      <tr
                        key={`${automation.environmentId}:${automation.id}`}
                        aria-label={`Open automation ${automation.name}`}
                        className="cursor-pointer border-b border-border transition-colors hover:bg-muted/20"
                        onClick={() => openEdit(automation)}
                      >
                        {projectFilter === null ? (
                          <ProjectIconCell
                            project={automationProject?.favicon ?? null}
                            name={automation.projectName}
                          />
                        ) : null}
                        <td className="truncate py-4 pr-4 font-medium text-foreground">
                          <button
                            type="button"
                            className="inline-block max-w-full truncate text-left font-medium text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEdit(automation);
                            }}
                          >
                            {automation.name}
                          </button>
                          {automation.createdBy === "agent" ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              Proposed
                            </span>
                          ) : null}
                        </td>
                        <td
                          className="truncate px-4 py-4 text-muted-foreground"
                          title={scheduleLabel}
                        >
                          {scheduleLabel}
                        </td>
                        <td
                          className="truncate px-4 py-4 text-muted-foreground"
                          title={createsLabel}
                        >
                          {createsLabel}
                        </td>
                        <td
                          className="truncate px-4 py-4 text-muted-foreground"
                          title={`${formatTimestamp(automation.lastFiredAt)}${lastRun && lastRun.outcome !== "created" ? ` (${lastRun.outcome})` : ""}`}
                        >
                          {formatListTimestamp(automation.lastFiredAt)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={automation.status === "enabled"}
                            disabled={!editable || savingKey !== null}
                            aria-label={`${automation.status === "enabled" ? "Pause" : "Enable"} ${automation.name}`}
                            onClick={(event) => event.stopPropagation()}
                            onCheckedChange={(checked) => {
                              const nextStatus = checked ? "enabled" : "disabled";
                              if (nextStatus !== automation.status)
                                void setStatus(automation, nextStatus);
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </WorkspaceViewLayout>
  );
}
