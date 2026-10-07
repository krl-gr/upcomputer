import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontalIcon, XIcon } from "lucide-react";
import {
  automationTaskCreator,
  type TaskAutomationCatchUpPolicy,
  type TaskAutomationId,
  type TaskAutomationListItem,
} from "@t3tools/tasks-contracts/v1";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../../../../../apps/web/src/components/ui/menu.tsx";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "../../../../../apps/web/src/components/ui/popover.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import { Switch } from "../../../../../apps/web/src/components/ui/switch.tsx";
import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { Toggle } from "../../../../../apps/web/src/components/ui/toggle.tsx";
import { formatRelativeTimeLabel } from "../../../../../apps/web/src/timestampFormat.ts";
import { TaskPageLoader, type TaskPageLoadState } from "../../state/taskPageLoader.ts";
import {
  WEEKDAYS,
  calendarScheduleToCron,
  describeCalendarSchedule,
  type CalendarScheduleMode,
} from "../../ui/automationCalendarSchedule.ts";
import { TablePill } from "../../ui/TablePill.tsx";
import { useAutomations } from "../data/hooks.ts";
import {
  AUTOMATION_STATUS_LABELS,
  CATCH_UP_POLICIES,
  MONTH_DAYS,
  SCHEDULE_MODES,
  automationFormOf,
  automationScheduleError,
  automationUpsertOf,
  emptyAutomationForm,
  shortDateTime,
  type AutomationFormState,
} from "../logic/automationForm.ts";
import type { PlannerWindow } from "../windows/windowStore.ts";
import { DescriptionField } from "./DescriptionField.tsx";
import { FloatingWindow } from "./FloatingWindow.tsx";
import { IconAction } from "./IconAction.tsx";
import { ProjectChip } from "./ProjectChip.tsx";
import { usePlanner } from "./plannerContext.ts";
import { ConfirmDeleteDialog } from "./TaskDialogs.tsx";
import { TagsField } from "./TagsField.tsx";
import { TitleInput } from "./TitleInput.tsx";

type AutomationPlannerWindow = Extract<PlannerWindow, { kind: "automation" }>;

const FIELD_CLASS =
  "h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring";
const POPOVER_FIELD_CLASS =
  "h-9 w-full rounded-md border border-border/70 bg-transparent px-3 text-sm text-foreground outline-none";

/** A label and its control on one line, as the task window's tags. */
function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{props.label}</span>
      <div className="flex min-w-0 flex-1 items-center">{props.children}</div>
    </div>
  );
}

/** Frequency, days, time or cron, and time zone (the former Automations page's editor). */
function ScheduleEditor(props: {
  readonly form: AutomationFormState;
  readonly onChange: (form: AutomationFormState) => void;
}) {
  const { form, onChange } = props;
  const error = automationScheduleError(form);
  const setSchedule = (patch: Partial<AutomationFormState["schedule"]>) =>
    onChange({ ...form, schedule: { ...form.schedule, ...patch } });
  return (
    <div className="flex flex-col gap-3">
      <Select
        value={form.schedule.mode}
        onValueChange={(value) =>
          setSchedule({ mode: (value ?? "weekly") as CalendarScheduleMode })
        }
      >
        <SelectTrigger aria-label="Frequency">
          <SelectValue>
            {SCHEDULE_MODES.find(({ value }) => value === form.schedule.mode)?.label}
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
                className="min-w-0 flex-1"
                onPressedChange={() =>
                  setSchedule({
                    weekdays: selected
                      ? form.schedule.weekdays.filter((value) => value !== day.value)
                      : [...form.schedule.weekdays, day.value],
                  })
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
          onValueChange={(value) => setSchedule({ monthDay: Number(value ?? 1) })}
        >
          <SelectTrigger aria-label="Day of month">
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
          className={`${POPOVER_FIELD_CLASS} font-mono`}
          value={form.schedule.customCron}
          aria-label="Cron expression"
          onChange={(event) => setSchedule({ customCron: event.target.value })}
        />
      ) : (
        <input
          type="time"
          className={POPOVER_FIELD_CLASS}
          value={form.schedule.time}
          aria-label="Schedule time"
          onChange={(event) => setSchedule({ time: event.target.value })}
        />
      )}
      <input
        aria-invalid={!form.timezone.trim()}
        className={POPOVER_FIELD_CLASS}
        value={form.timezone}
        aria-label="Time zone"
        onChange={(event) => onChange({ ...form, timezone: event.target.value })}
      />
      {error ? (
        <p aria-live="polite" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The tasks this automation created, newest first (they go first when
 * created), paged; one opens in its task window. The planner's Tasks lists
 * leave these out.
 */
function AutomationTasks(props: { readonly automationId: string }) {
  const { store, windows } = usePlanner();
  const [state, setState] = useState<TaskPageLoadState | null>(null);
  const loader = useRef<TaskPageLoader | null>(null);
  useEffect(() => {
    const target = store.listTarget;
    const next = new TaskPageLoader(
      target,
      {
        createdBy: automationTaskCreator(props.automationId as TaskAutomationId),
        audience: "all",
        kind: "task",
        archive: "all",
        limit: 20,
      },
      setState,
    );
    loader.current = next;
    const unsubscribe = target.client.tasks.subscribe((change) => next.change(change));
    next.refresh();
    return () => {
      unsubscribe();
      next.dispose();
      loader.current = null;
    };
  }, [store, props.automationId]);
  const tasks = state?.page?.tasks ?? [];
  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm font-medium text-foreground">Tasks</div>
      {state?.error ? <p className="text-sm text-destructive-foreground">{state.error}</p> : null}
      {tasks.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {state === null || state.initialLoading ? "Loading…" : "No created tasks yet."}
        </p>
      ) : (
        <div className="-mx-2 flex flex-col">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60"
              onClick={() => windows.openDetail(task.id)}
            >
              <span
                className={
                  task.archivedAt
                    ? "min-w-0 flex-1 truncate text-muted-foreground"
                    : "min-w-0 flex-1 truncate text-foreground"
                }
              >
                {task.title}
              </span>
              <TablePill>{task.archivedAt ? "Archived" : task.status}</TablePill>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatRelativeTimeLabel(task.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
      {state?.page?.nextCursor ? (
        <div className="flex justify-center pt-1">
          <Button
            size="xs"
            variant="outline"
            disabled={state.loadingMore}
            onClick={() => loader.current?.loadMore()}
          >
            {state.loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * An automation's settings, the task it creates and the tasks it created, in
 * a floating window like a task's. An existing automation saves each change
 * at once (text on blur, the schedule when its popover closes); a new one is
 * created disabled from the footer.
 */
function AutomationSettings(props: {
  readonly window: AutomationPlannerWindow;
  readonly zIndex: number;
  readonly automation: TaskAutomationListItem | null;
  readonly defaultProjectId: string | null;
}) {
  const { automations, windows, projects, markdownCwd } = usePlanner();
  const { automation } = props;
  const [form, setForm] = useState<AutomationFormState>(() =>
    automation
      ? automationFormOf(automation)
      : emptyAutomationForm(
          props.defaultProjectId ??
            projects.find((project) => !project.inbox)?.id ??
            projects[0]?.id ??
            null,
        ),
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const scheduleBefore = useRef<AutomationFormState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const close = () => windows.close(props.window.id);

  /** Saves an existing automation's form; a new one only keeps it until Create. */
  const commit = (next: AutomationFormState) => {
    setForm(next);
    if (!automation) return;
    const upsert = automationUpsertOf(next, automation);
    if ("error" in upsert) {
      toastManager.add({ type: "error", title: upsert.error });
      return;
    }
    void automations.upsert(upsert.input);
  };
  const commitText = (field: "name" | "title" | "taskStatus" | "description") => {
    if (!automation) return;
    const saved = automationFormOf(automation);
    const value = form[field];
    if (value === saved[field]) return;
    if (field !== "description" && field !== "taskStatus" && !value.trim()) {
      setForm({ ...form, [field]: saved[field] });
      return;
    }
    commit(form);
  };
  const onScheduleOpenChange = (open: boolean) => {
    setScheduleOpen(open);
    if (open) {
      scheduleBefore.current = form;
      return;
    }
    const before = scheduleBefore.current;
    scheduleBefore.current = null;
    if (!before || !automation) return;
    if (automationScheduleError(form) !== null) {
      setForm(before);
      return;
    }
    if (
      JSON.stringify(form.schedule) !== JSON.stringify(before.schedule) ||
      form.timezone !== before.timezone
    )
      commit(form);
  };
  const create = async () => {
    const upsert = automationUpsertOf(form, null);
    if ("error" in upsert) {
      toastManager.add({ type: "warning", title: upsert.error });
      return;
    }
    setSaving(true);
    const created = await automations.upsert(upsert.input);
    setSaving(false);
    if (!created) return;
    toastManager.add({
      type: "success",
      title: "Automation created",
      description: `${created.name} stays disabled until you enable it.`,
    });
    windows.openAutomation(created.id, props.window.id);
  };
  const setStatus = (enabled: boolean) => {
    if (automation) void automations.setStatus(automation.id, enabled ? "enabled" : "disabled");
  };
  const scheduleError = automationScheduleError(form);

  return (
    <FloatingWindow
      width={560}
      zIndex={props.zIndex}
      position={props.window.position}
      onFocus={() => windows.focus(props.window.id)}
      onMove={(position) => windows.move(props.window.id, position)}
      onDismiss={close}
      header={
        <>
          <TitleInput
            value={form.name}
            placeholder="Automation name"
            ariaLabel="Automation name"
            onChange={(name) => setForm({ ...form, name })}
            onBlur={() => commitText("name")}
          />
          {automation ? (
            <Menu>
              <MenuTrigger
                render={<Button size="icon-sm" variant="outline" aria-label="More actions" />}
              >
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => setStatus(automation.status !== "enabled")}>
                  {automation.status === "enabled" ? "Disable" : "Enable"}
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => setDeleting(true)}>
                  Delete automation
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
          <IconAction label="Close" variant="outline" size="icon-sm" onClick={close}>
            <XIcon />
          </IconAction>
        </>
      }
      footer={
        automation ? undefined : (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={saving} onClick={() => void create()}>
              Create
            </Button>
            <Button className="flex-1" variant="outline" onClick={close}>
              Cancel
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ProjectChip
            projects={projects}
            value={form.projectId}
            onChange={(projectId) => {
              if (projectId) commit({ ...form, projectId });
            }}
          />
          {automation ? (
            <>
              <TablePill>{AUTOMATION_STATUS_LABELS[automation.status]}</TablePill>
              <Switch
                checked={automation.status === "enabled"}
                aria-label={automation.status === "enabled" ? "Disable" : "Enable"}
                onCheckedChange={(checked) => setStatus(Boolean(checked))}
              />
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Created disabled</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Field label="Schedule">
            <Popover open={scheduleOpen} onOpenChange={onScheduleOpenChange}>
              <PopoverTrigger
                render={
                  <Button
                    size="xs"
                    variant="outline"
                    className="max-w-full min-w-0"
                    aria-label="Edit schedule"
                  />
                }
              >
                <span className="truncate">
                  {scheduleError
                    ? "Complete schedule"
                    : `${describeCalendarSchedule(form.schedule)} · ${form.timezone}`}
                </span>
              </PopoverTrigger>
              <PopoverPopup
                side="bottom"
                align="start"
                className="w-[360px] max-w-[calc(100vw-24px)]"
                padding="compact"
              >
                <ScheduleEditor form={form} onChange={setForm} />
              </PopoverPopup>
            </Popover>
          </Field>
          {automation ? (
            <Field label="Runs">
              <span className="min-w-0 truncate text-muted-foreground">
                {automation.status === "enabled" && automation.nextRunAt
                  ? `Next ${shortDateTime(automation.nextRunAt)}`
                  : "Not scheduled"}
                {automation.lastFiredAt ? ` · last ${shortDateTime(automation.lastFiredAt)}` : ""}
              </span>
            </Field>
          ) : null}
          {automation?.lastError ? (
            <p className="text-sm text-destructive-foreground">{automation.lastError}</p>
          ) : null}
          <Field label="Missed run">
            <Select
              value={form.catchUpPolicy}
              onValueChange={(value) =>
                commit({
                  ...form,
                  catchUpPolicy: (value ?? "fire-once") as TaskAutomationCatchUpPolicy,
                })
              }
            >
              <SelectTrigger size="xs" className="w-auto min-w-0" aria-label="Missed run policy">
                <SelectValue>
                  {CATCH_UP_POLICIES.find(({ value }) => value === form.catchUpPolicy)?.label}
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
          </Field>
          <Field label="Skip if open">
            <Switch
              checked={form.skipIfOpen}
              aria-label="Skip while a task it created is not archived"
              onCheckedChange={(checked) => commit({ ...form, skipIfOpen: Boolean(checked) })}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="text-sm font-medium text-foreground">Creates a task</div>
          <Field label="Title">
            <input
              className={FIELD_CLASS}
              value={form.title}
              placeholder="Task title"
              aria-label="Created task title"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              onBlur={() => commitText("title")}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </Field>
          <Field label="Status">
            <input
              className={FIELD_CLASS}
              value={form.taskStatus}
              aria-label="Created task status"
              onChange={(event) => setForm({ ...form, taskStatus: event.target.value })}
              onBlur={() => commitText("taskStatus")}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </Field>
          <TagsField
            key={form.tags.join("\u0000")}
            tags={form.tags}
            onSave={(tags) => commit({ ...form, tags })}
          />
          <div onBlur={() => commitText("description")}>
            <DescriptionField
              value={form.description}
              onChange={(description) => setForm({ ...form, description })}
              cwd={markdownCwd}
              rows={6}
            />
          </div>
        </div>
        {automation ? (
          <div className="border-t pt-3">
            <AutomationTasks automationId={automation.id} />
          </div>
        ) : null}
      </div>
      <ConfirmDeleteDialog
        open={deleting}
        title="Delete automation"
        description={`"${automation?.name ?? "This automation"}" stops creating tasks. The tasks it created stay in the table. This cannot be undone.`}
        onOpenChange={setDeleting}
        onConfirm={() => {
          if (!automation) return;
          close();
          void automations.remove(automation.id);
        }}
      />
    </FloatingWindow>
  );
}

/** An automation's window, or a new automation's; follows the environment's automation list. */
export function AutomationWindow(props: {
  readonly window: AutomationPlannerWindow;
  readonly zIndex: number;
  readonly defaultProjectId: string | null;
}) {
  const { automations, windows } = usePlanner();
  const snapshot = useAutomations(automations);
  const { automationId } = props.window;
  if (automationId === null)
    return (
      <AutomationSettings
        window={props.window}
        zIndex={props.zIndex}
        automation={null}
        defaultProjectId={props.defaultProjectId}
      />
    );
  const automation = snapshot.automations.find((candidate) => candidate.id === automationId);
  if (automation)
    return (
      <AutomationSettings
        key={automation.id}
        window={props.window}
        zIndex={props.zIndex}
        automation={automation}
        defaultProjectId={props.defaultProjectId}
      />
    );
  return (
    <FloatingWindow
      width={560}
      zIndex={props.zIndex}
      position={props.window.position}
      onFocus={() => windows.focus(props.window.id)}
      onMove={(position) => windows.move(props.window.id, position)}
      onDismiss={() => windows.close(props.window.id)}
      header={
        <>
          <span className="min-w-0 flex-1 pt-1 text-lg font-semibold text-muted-foreground">
            Automation
          </span>
          <IconAction
            label="Close"
            variant="outline"
            size="icon-sm"
            onClick={() => windows.close(props.window.id)}
          >
            <XIcon />
          </IconAction>
        </>
      }
    >
      <p className="py-8 text-center text-sm text-muted-foreground">
        {snapshot.status === "loading" ? "Loading…" : "This automation was deleted."}
      </p>
    </FloatingWindow>
  );
}
