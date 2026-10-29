import { useMemo, useState } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarIcon,
  CircleCheckIcon,
  ListPlusIcon,
  MoreHorizontalIcon,
  XIcon,
} from "lucide-react";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../../../../apps/web/src/components/ui/dialog.tsx";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../../../../../apps/web/src/components/ui/menu.tsx";
import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";
import { useQueueInstancesByTaskId, useTaskById } from "../data/hooks.ts";
import type { PlannerSnapshot } from "../data/plannerStore.ts";
import { todayKey } from "../logic/dates.ts";
import { countProgress, progressLabel, weekRangeOf } from "../logic/progress.ts";
import { clearDraft, readDraft, useDraft } from "../windows/draftStore.ts";
import type { PlannerWindow } from "../windows/windowStore.ts";
import { handOffAgents, handOffPatch } from "../logic/handOff.ts";
import { DescriptionField } from "./DescriptionField.tsx";
import { AutomationWindow } from "./AutomationWindow.tsx";
import { FloatingWindow, FloatingWindowDocked } from "./FloatingWindow.tsx";
import { IconAction } from "./IconAction.tsx";
import { ProjectChip } from "./ProjectChip.tsx";
import { usePlanner } from "./plannerContext.ts";
import { ScheduleTable } from "./ScheduleTable.tsx";
import { RunSummary } from "./RunSummary.tsx";
import { ConfirmDeleteDialog, ConfirmHandOffDialog } from "./TaskDialogs.tsx";
import { toastAudienceMoved } from "./audienceMoved.ts";
import { isFinished } from "./TaskRow.tsx";
import { TitleInput } from "./TitleInput.tsx";

/** Wande's "Open full screen" for a description: the same editor, large, in a dialog. */
function FullScreenDescription(props: {
  readonly open: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Description</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <DescriptionField
            value={props.value}
            onChange={props.onChange}
            autoFocus
            className="min-h-[60vh] text-sm"
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

interface WindowFrameProps {
  readonly window: PlannerWindow;
  readonly zIndex: number;
}

/**
 * Wande's TaskDetailWindow. Project and status save at once, the title on
 * blur, the description when the window closes (X), as in wande; unsaved
 * text stays in the draft while the window is open, even off /tasks.
 */
export function TaskDetailWindow(
  props: WindowFrameProps & {
    readonly taskId: string;
    readonly snapshot: PlannerSnapshot;
    readonly queueDate: string | null;
  },
) {
  const { store, windows, projects, preferences, agents, openInTable, openInPlanner } =
    usePlanner();
  const window = props.window;
  const viewMode = window.kind === "detail" ? window.viewMode : "description";
  const task = useTaskById(store, props.snapshot, props.taskId);
  const missing = props.snapshot.missingTaskIds.has(props.taskId);
  const entries = useQueueInstancesByTaskId(store, props.snapshot, props.taskId, true);
  const draftKey = `task:${props.taskId}`;
  const [draft, updateDraft] = useDraft(draftKey);
  const [menuDelete, setMenuDelete] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const title = draft.title ?? task?.title ?? "";
  const description = draft.description ?? task?.description ?? "";
  // A routine counts this week, like its list row.
  const routine = task?.kind === "routine";
  const weekStartDay = preferences.weekStartDay;
  const week = useMemo(
    () => (routine ? weekRangeOf(todayKey(), weekStartDay) : undefined),
    [routine, weekStartDay],
  );
  const progress = progressLabel(
    entries ? countProgress(entries, week) : props.snapshot.progress.get(props.taskId),
  );
  const close = () => {
    clearDraft(draftKey);
    windows.close(window.id);
  };
  const saveTitle = () => {
    const current = readDraft(draftKey).title;
    if (current === undefined || !task) return;
    const next = current.trim();
    if (!next) return;
    clearDraft(draftKey, ["title"]);
    if (next !== task.title) void store.updateTask(task.id, { title: next });
  };
  const saveAndClose = () => {
    if (!task) {
      close();
      return;
    }
    const next = title.trim();
    if (!next) {
      toastManager.add({ type: "warning", title: "Please enter a task title" });
      return;
    }
    // The draft store, not this render: Escape can close in the event that
    // ended the editor's last edit.
    const description = readDraft(draftKey).description ?? task.description;
    const patch = {
      ...(next !== task.title ? { title: next } : {}),
      ...(description !== task.description ? { description } : {}),
    };
    if (Object.keys(patch).length > 0) void store.updateTask(task.id, patch);
    close();
  };
  const finished = task ? isFinished(task) : false;
  const agentsForTask = useMemo(
    () => (task ? handOffAgents(agents, task.projectId) : []),
    [agents, task],
  );

  return (
    <FloatingWindow
      width={560}
      zIndex={props.zIndex}
      position={window.position}
      onFocus={() => windows.focus(window.id)}
      onMove={(position) => windows.move(window.id, position)}
      onDismiss={saveAndClose}
      header={
        <>
          <TitleInput
            value={title}
            placeholder="Enter task title"
            onChange={(value) => updateDraft({ title: value })}
            onBlur={saveTitle}
          />
          <Menu>
            <MenuTrigger
              render={<Button size="icon-sm" variant="outline" aria-label="More actions" />}
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                onClick={() => {
                  windows.setViewMode(window.id, "description");
                  setFullScreen(true);
                }}
              >
                Open full screen
              </MenuItem>
              <MenuItem disabled={!task} onClick={() => openInTable(props.taskId)}>
                Open in table (runs)
              </MenuItem>
              {routine ? null : <MenuSeparator />}
              {routine ? null : task?.audience === "agent" ? (
                <MenuItem
                  onClick={() =>
                    void store.updateTask(task.id, { audience: "person" }).then((moved) => {
                      if (moved)
                        toastAudienceMoved("person", task.title, () => openInPlanner(task.id));
                    })
                  }
                >
                  Take back from workers
                </MenuItem>
              ) : (
                <MenuItem disabled={!task} onClick={() => setHandingOff(true)}>
                  Hand to a worker…
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem variant="destructive" disabled={!task} onClick={() => setMenuDelete(true)}>
                Delete task
              </MenuItem>
            </MenuPopup>
          </Menu>
          <IconAction
            label="Save and close"
            variant="outline"
            size="icon-sm"
            onClick={saveAndClose}
          >
            <XIcon />
          </IconAction>
        </>
      }
    >
      {missing && !task ? (
        <p className="py-8 text-center text-sm text-muted-foreground">This task was deleted.</p>
      ) : !task ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-1">
            <ProjectChip
              projects={projects}
              value={task.projectId}
              onChange={(projectId) => {
                if (projectId) void store.updateTask(task.id, { projectId: projectId as never });
              }}
            />
            {finished ? (
              <IconAction
                label="Restore"
                variant="outline"
                onClick={() => void store.restore([task.id])}
              >
                <ArchiveRestoreIcon />
              </IconAction>
            ) : (
              <>
                <IconAction
                  label="Mark as done"
                  variant="outline"
                  onClick={() => void store.markDone([task.id])}
                >
                  <CircleCheckIcon />
                </IconAction>
                <IconAction
                  label="Archive"
                  variant="outline"
                  onClick={() => void store.archive([task.id])}
                >
                  <ArchiveIcon />
                </IconAction>
              </>
            )}
            <RunSummary task={task} />
            {props.queueDate && preferences.weekViewMode === "queue" ? (
              <IconAction
                label={`Add to queue for ${props.queueDate}`}
                variant="outline"
                onClick={() =>
                  void store.addEntries({ taskIds: [task.id], date: props.queueDate! })
                }
              >
                <ListPlusIcon />
              </IconAction>
            ) : null}
            <IconAction
              label={viewMode === "description" ? "Show the schedule" : "Show the description"}
              variant={viewMode === "instances" ? "secondary" : "outline"}
              size={progress ? "xs" : "icon-xs"}
              pressed={viewMode === "instances"}
              onClick={() =>
                windows.setViewMode(
                  window.id,
                  viewMode === "description" ? "instances" : "description",
                )
              }
            >
              <CalendarIcon />
              {progress ? <span>{progress}</span> : null}
            </IconAction>
          </div>
          {viewMode === "description" ? (
            // One editor per draft: the full screen dialog takes it over while open.
            fullScreen ? null : (
              <DescriptionField
                value={description}
                onChange={(value) => updateDraft({ description: value })}
              />
            )
          ) : (
            <ScheduleTable taskId={task.id} entries={entries} />
          )}
        </div>
      )}
      <FullScreenDescription
        open={fullScreen}
        value={description}
        onChange={(value) => updateDraft({ description: value })}
        onOpenChange={setFullScreen}
      />
      <ConfirmHandOffDialog
        open={handingOff}
        title={task?.title ?? "This task"}
        agents={agentsForTask}
        onOpenChange={setHandingOff}
        onConfirm={(agentId) => {
          if (!task) return;
          const agent = agentsForTask.find(({ id }) => id === agentId) ?? null;
          void store.updateTask(task.id, handOffPatch(task, agent)).then((moved) => {
            if (moved) toastAudienceMoved("agent", title, () => openInTable(props.taskId));
          });
        }}
      />
      <ConfirmDeleteDialog
        open={menuDelete}
        title="Delete task"
        description={`"${task?.title ?? "This task"}" and its schedule are deleted. This cannot be undone.`}
        onOpenChange={setMenuDelete}
        onConfirm={() => {
          close();
          void store.deleteTasks([props.taskId]);
        }}
      />
    </FloatingWindow>
  );
}

/** Wande's CreateTaskWindow: title, project and description; the task goes to the top. */
export function CreateTaskWindow(
  props: WindowFrameProps & { readonly defaultProjectId: string | null },
) {
  const { store, windows, projects } = usePlanner();
  const window = props.window;
  const initial = window.kind === "create" ? window.initial : {};
  const kind = initial.kind ?? "task";
  const noun = kind === "routine" ? "routine" : "task";
  const [draft, updateDraft] = useDraft(window.id);
  const [fullScreen, setFullScreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const projectId =
    draft.projectId !== undefined
      ? draft.projectId || null
      : (initial.projectId ?? props.defaultProjectId);
  const close = () => {
    clearDraft(window.id);
    windows.close(window.id);
  };
  const create = async () => {
    const title = (draft.title ?? "").trim();
    if (!title) {
      toastManager.add({ type: "warning", title: `Please enter a ${noun} title` });
      return;
    }
    setSaving(true);
    const created = await store.createTask({
      title,
      description: draft.description ?? "",
      kind,
      ...(projectId ? { projectId: projectId as never } : {}),
      ...(initial.beforeTaskId ? { beforeTaskId: initial.beforeTaskId } : {}),
      ...(initial.afterTaskId ? { afterTaskId: initial.afterTaskId } : {}),
    });
    setSaving(false);
    if (created) close();
  };
  return (
    <FloatingWindow
      width={520}
      zIndex={props.zIndex}
      position={window.position}
      onFocus={() => windows.focus(window.id)}
      onMove={(position) => windows.move(window.id, position)}
      onDismiss={close}
      header={
        <>
          <TitleInput
            value={draft.title ?? ""}
            placeholder={`Enter ${noun} title`}
            onChange={(value) => updateDraft({ title: value })}
          />
          <Menu>
            <MenuTrigger
              render={<Button size="icon-sm" variant="outline" aria-label="More actions" />}
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setFullScreen(true)}>Open full screen</MenuItem>
            </MenuPopup>
          </Menu>
        </>
      }
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" disabled={saving} onClick={() => void create()}>
            Create
          </Button>
          <Button className="flex-1" variant="outline" onClick={close}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1">
          <ProjectChip
            projects={projects}
            value={projectId}
            allowNewInbox
            onChange={(next) => updateDraft({ projectId: next ?? "" })}
          />
        </div>
        {fullScreen ? null : (
          <DescriptionField
            value={draft.description ?? ""}
            onChange={(value) => updateDraft({ description: value })}
          />
        )}
      </div>
      <FullScreenDescription
        open={fullScreen}
        value={draft.description ?? ""}
        onChange={(value) => updateDraft({ description: value })}
        onOpenChange={setFullScreen}
      />
    </FloatingWindow>
  );
}

/**
 * Every open window, stacked by focus order between the page and its dialogs
 * (z 30 to 45). Docked, only the front window shows, over the planner; closing
 * it uncovers the next.
 */
export function PlannerWindows(props: {
  readonly windows: readonly PlannerWindow[];
  readonly snapshot: PlannerSnapshot;
  readonly queueDate: string | null;
  readonly defaultProjectId: string | null;
  readonly docked?: boolean;
}) {
  const order = useMemo(
    () => new Map([...props.windows].sort((a, b) => a.z - b.z).map((w, index) => [w.id, index])),
    [props.windows],
  );
  const shown = props.docked
    ? props.windows.filter((window) => order.get(window.id) === props.windows.length - 1)
    : props.windows;
  return (
    <FloatingWindowDocked value={props.docked ?? false}>
      {shown.map((window) => {
        const zIndex = 30 + Math.min(15, order.get(window.id) ?? 0);
        if (window.kind === "automation")
          return (
            <AutomationWindow
              key={window.id}
              window={window}
              zIndex={zIndex}
              defaultProjectId={props.defaultProjectId}
            />
          );
        return window.kind === "detail" ? (
          <TaskDetailWindow
            key={window.id}
            window={window}
            zIndex={zIndex}
            taskId={window.taskId}
            snapshot={props.snapshot}
            queueDate={props.queueDate}
          />
        ) : (
          <CreateTaskWindow
            key={window.id}
            window={window}
            zIndex={zIndex}
            defaultProjectId={props.defaultProjectId}
          />
        );
      })}
    </FloatingWindowDocked>
  );
}
