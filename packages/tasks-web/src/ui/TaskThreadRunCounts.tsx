import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { ListTodoIcon } from "lucide-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { TaskThreadTasksResult } from "@t3tools/tasks-contracts/v1";
import type {
  ExperimentalWebThreadAccessoryProps,
  ExperimentalWebThreadRowAccessoryProps,
} from "../../../../apps/web/src/extensionApi.ts";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../../../apps/web/src/components/ui/menu.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import {
  readTasksWebAccess,
  readTasksWebClient,
  useTasksWebAccessRevision,
} from "../environmentApi.ts";
import type { TasksWebRpcClient } from "../rpc/index.ts";
import { threadRunCountsStore, type ThreadRunCountsStore } from "../state/threadRunCounts.ts";
import { taskKey } from "./shared.ts";
import { RunCountNumbers, runCountSummary } from "./RunCountNumbers.tsx";
import { attentionRunCountGroups, groupTaskRunCounts } from "./taskRunPresentation.ts";

const THREAD_TASKS_LIMIT = 50;
const MENU_NOTE_CLASS = "px-2 py-1.5 text-muted-foreground text-sm";

// The row opens its thread on click and Enter/Space. React events from the
// portaled menu bubble through the row too, so both trigger and popup stop them.
// Escape must keep bubbling: the menu closes from a document listener.
const stopRowEvent = (event: SyntheticEvent) => event.stopPropagation();
const stopRowKeyActivation = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
};

/** Mounted only while the menu is open: one request per opening, no subscription. */
function ThreadTasksMenuItems({
  client,
  environmentId,
  threadId,
}: {
  client: TasksWebRpcClient;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskThreadTasksResult["tasks"] | "loading" | "error">(
    "loading",
  );
  useEffect(() => {
    let active = true;
    client.tasks.threadTasks({ threadId, limit: THREAD_TASKS_LIMIT }).then(
      (result) => active && setTasks(result.tasks),
      () => active && setTasks("error"),
    );
    return () => {
      active = false;
    };
  }, [client, threadId]);
  if (tasks === "loading") return <p className={MENU_NOTE_CLASS}>Loading tasks…</p>;
  if (tasks === "error") return <p className={MENU_NOTE_CLASS}>Could not load tasks.</p>;
  if (tasks.length === 0) return <p className={MENU_NOTE_CLASS}>No tasks.</p>;
  return tasks.map((task) => (
    <MenuItem
      key={task.id}
      onClick={() =>
        void navigate({
          to: "/tasks",
          search: { task: taskKey({ environmentId, id: task.id }) },
        } as never)
      }
    >
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
        <RunCountNumbers groups={groupTaskRunCounts(task.runCounts)} />
      </span>
    </MenuItem>
  ));
}

/** The thread's tasks menu, opened by `trigger`, a `MenuTrigger`. */
function ThreadTasksMenu({
  client,
  environmentId,
  threadId,
  trigger,
  onOpenChange,
}: {
  client: TasksWebRpcClient;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  trigger: ReactElement;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  return (
    <Menu {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger}
      <MenuPopup
        align="end"
        className="w-72"
        onClick={stopRowEvent}
        onDoubleClick={stopRowEvent}
        onContextMenu={stopRowEvent}
        onKeyDown={stopRowKeyActivation}
      >
        <ThreadTasksMenuItems client={client} environmentId={environmentId} threadId={threadId} />
      </MenuPopup>
    </Menu>
  );
}

function useThreadRunCountGroups(store: ThreadRunCountsStore, threadId: ThreadId) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(threadId, listener),
    [store, threadId],
  );
  const snapshot = useCallback(() => store.get(threadId), [store, threadId]);
  const counts = useSyncExternalStore(subscribe, snapshot, snapshot);
  // One foreground handler per mounted row is unnecessary; the shared stream reconciles reconnects.
  return useMemo(() => groupTaskRunCounts(counts), [counts]);
}

function Counts({
  client,
  store,
  environmentId,
  threadId,
  fallback,
}: ExperimentalWebThreadRowAccessoryProps & {
  client: TasksWebRpcClient;
  store: ThreadRunCountsStore;
}) {
  const groups = useThreadRunCountGroups(store, threadId);
  if (groups.length === 0) return fallback;
  const summary = `Task runs · ${groups.map((group) => `${group.label}: ${group.count}`).join(" · ")}`;
  return (
    <ThreadTasksMenu
      client={client}
      environmentId={environmentId}
      threadId={threadId}
      trigger={
        // Its own slot: the themed chat header fills every `menu-trigger` as a
        // toolbar control, while these counts stay bare numbers as in the sidebar.
        <MenuTrigger
          data-slot="task-run-counts"
          className="pointer-events-auto inline-flex cursor-pointer items-center gap-1 rounded-sm tabular-nums opacity-80 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-popup-open:opacity-100"
          data-task-run-counts={threadId}
          aria-label={summary}
          title={[summary, "Active runs, and finished runs since the thread was last opened"].join(
            "\n",
          )}
          onPointerDown={stopRowEvent}
          onClick={stopRowEvent}
          onKeyDown={stopRowKeyActivation}
        >
          <RunCountNumbers groups={groups} />
        </MenuTrigger>
      }
    />
  );
}

/** How long a person must look at a thread before leaving it marks its runs seen. */
const SEEN_DWELL_MS = 1000;

/**
 * Marks the open thread's finished runs seen when the person stops looking at it: they leave
 * the thread, or the window loses focus or is hidden. Only a look of at least `SEEN_DWELL_MS`
 * counts, so skimming past threads keeps their counts. Runs that finish while the window is in
 * the background stay unseen until the next look.
 */
function ThreadSeen({ store, threadId }: { store: ThreadRunCountsStore; threadId: ThreadId }) {
  useEffect(() => {
    // Following the thread keeps its counts in the store until the last check below.
    const unfollow = store.subscribe(threadId, () => {});
    let lookingSince: number | null = null;
    const looking = () => document.visibilityState === "visible" && document.hasFocus();
    const end = () => {
      if (lookingSince === null) return;
      const looked = Date.now() - lookingSince >= SEEN_DWELL_MS;
      lookingSince = null;
      if (looked) store.markSeen(threadId);
    };
    const update = () => {
      if (!looking()) end();
      else lookingSince ??= Date.now();
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("pagehide", end);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("pagehide", end);
      document.removeEventListener("visibilitychange", update);
      end();
      unfollow();
    };
  }, [store, threadId]);
  return null;
}

/** In the open thread's header: leaving the thread marks its finished runs seen. */
export function TaskThreadSeen(props: ExperimentalWebThreadAccessoryProps) {
  useTasksWebAccessRevision();
  if (!readTasksWebAccess(props.environmentId).canReadTasks) return null;
  const client = readTasksWebClient(props.environmentId);
  return <ThreadSeen store={threadRunCountsStore(client)} threadId={props.threadId} />;
}

export function TaskThreadRunCounts(props: ExperimentalWebThreadRowAccessoryProps) {
  useTasksWebAccessRevision();
  if (!readTasksWebAccess(props.environmentId).canReadTasks) return props.fallback;
  const client = readTasksWebClient(props.environmentId);
  return <Counts {...props} client={client} store={threadRunCountsStore(client)} />;
}

/**
 * The run counts' tasks menu from an icon button, for a row whose thread has tasks but no
 * counts to show. `className` gives the button its row's look.
 */
export function TaskThreadTasksButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly label: string;
  readonly className: string;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  useTasksWebAccessRevision();
  if (!readTasksWebAccess(props.environmentId).canReadTasks) return null;
  return (
    <ThreadTasksMenu
      client={readTasksWebClient(props.environmentId)}
      environmentId={props.environmentId}
      threadId={props.threadId}
      onOpenChange={props.onOpenChange}
      trigger={
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={props.label}
                    className={props.className}
                    onPointerDown={stopRowEvent}
                    onClick={stopRowEvent}
                    onKeyDown={stopRowKeyActivation}
                  />
                }
              />
            }
          >
            <ListTodoIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">Tasks</TooltipPopup>
        </Tooltip>
      }
    />
  );
}

/** A status colour as the light theme draws it: the pill stays light in either theme. */
function onLightPillClassName(className: string) {
  return className
    .split(" ")
    .filter((name) => !name.startsWith("dark:"))
    .map((name) => (name === "text-muted-foreground" ? "text-neutral-500" : name))
    .join(" ");
}

const PILL_SURFACE = "bg-neutral-200 dark:bg-neutral-100";

/**
 * Over the bot's top right in its 40px compact target, with a dot towards its head. The pill
 * starts 28px in and moves left rather than past the 92px column when its counts are wide.
 */
function RunPill({
  client,
  store,
  environmentId,
  threadId,
  name,
}: {
  client: TasksWebRpcClient;
  store: ThreadRunCountsStore;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  name: string;
}) {
  const groups = attentionRunCountGroups(useThreadRunCountGroups(store, threadId));
  if (groups.length === 0) return null;
  const summary = runCountSummary(groups);
  return (
    <span className="hidden [[data-sidebar-compact=true]_&]:contents">
      <span
        aria-hidden
        className={`pointer-events-none absolute top-1 left-[calc(50%+6px)] size-1 rounded-full ${PILL_SURFACE}`}
      />
      <span className="pointer-events-none absolute -top-2.5 left-[calc(50%-20px)] flex w-16">
        <span className="basis-7" />
        <ThreadTasksMenu
          client={client}
          environmentId={environmentId}
          threadId={threadId}
          trigger={
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <button
                        type="button"
                        data-bot-run-pill={threadId}
                        aria-label={`Tasks for ${name}: ${summary}`}
                        className={`pointer-events-auto flex h-[15px] flex-none cursor-pointer items-center gap-[3.5px] rounded-full px-[4.5px] text-[10px] leading-[15px] font-semibold tabular-nums outline-none hover:bg-neutral-300 focus-visible:ring-1 focus-visible:ring-ring dark:hover:bg-white ${PILL_SURFACE}`}
                        onPointerDown={stopRowEvent}
                        onClick={stopRowEvent}
                        onKeyDown={stopRowKeyActivation}
                      />
                    }
                  />
                }
              >
                <RunCountNumbers
                  groups={groups.map((group) => ({
                    ...group,
                    className: onLightPillClassName(group.className),
                  }))}
                />
              </TooltipTrigger>
              <TooltipPopup side="right">{summary}</TooltipPopup>
            </Tooltip>
          }
        />
      </span>
    </span>
  );
}

/**
 * A bot's run counts as a pill for the compact sidebar, where its row shows only the face.
 * It opens the same tasks menu as the counts in the full row. Completed runs are left out.
 */
export function TaskThreadRunPill(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly name: string;
}) {
  useTasksWebAccessRevision();
  if (!readTasksWebAccess(props.environmentId).canReadTasks) return null;
  const client = readTasksWebClient(props.environmentId);
  return <RunPill {...props} client={client} store={threadRunCountsStore(client)} />;
}
