import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { TaskThreadTasksResult } from "@t3tools/tasks-contracts/v1";
import type { ExperimentalWebThreadRowAccessoryProps } from "../../../../apps/web/src/extensionApi.ts";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "../../../../apps/web/src/components/ui/menu.tsx";
import {
  readTasksWebAccess,
  readTasksWebClient,
  useTasksWebAccessRevision,
} from "../environmentApi.ts";
import type { TasksWebRpcClient } from "../rpc/index.ts";
import { threadRunCountsStore, type ThreadRunCountsStore } from "../state/threadRunCounts.ts";
import { taskKey } from "./shared.ts";
import { groupTaskRunCounts, type TaskRunCountGroup } from "./taskRunPresentation.ts";

const THREAD_TASKS_LIMIT = 50;
const MENU_NOTE_CLASS = "px-2 py-1.5 text-muted-foreground text-sm";

// The row opens its thread on click and Enter/Space. React events from the
// portaled menu bubble through the row too, so both trigger and popup stop them.
// Escape must keep bubbling: the menu closes from a document listener.
const stopRowEvent = (event: SyntheticEvent) => event.stopPropagation();
const stopRowKeyActivation = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
};

function RunCountNumbers({ groups }: { groups: readonly TaskRunCountGroup[] }) {
  return groups.map((group) => (
    <span key={group.label} className={group.className}>
      {group.count}
    </span>
  ));
}

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
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(threadId, listener),
    [store, threadId],
  );
  const snapshot = useCallback(() => store.get(threadId), [store, threadId]);
  const counts = useSyncExternalStore(subscribe, snapshot, snapshot);
  // One foreground handler per mounted row is unnecessary; the shared stream reconciles reconnects.
  const groups = useMemo(() => groupTaskRunCounts(counts), [counts]);
  if (groups.length === 0) return fallback;
  const summary = `Task runs · ${groups.map((group) => `${group.label}: ${group.count}`).join(" · ")}`;
  return (
    <Menu>
      <MenuTrigger
        className="pointer-events-auto inline-flex cursor-pointer items-center gap-1 rounded-sm tabular-nums opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-popup-open:opacity-100"
        data-task-run-counts={threadId}
        aria-label={summary}
        title={[summary, "Runs with recorded origin, including previous attempts"]
          .filter(Boolean)
          .join("\n")}
        onPointerDown={stopRowEvent}
        onClick={stopRowEvent}
        onKeyDown={stopRowKeyActivation}
      >
        <RunCountNumbers groups={groups} />
      </MenuTrigger>
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

export function TaskThreadRunCounts(props: ExperimentalWebThreadRowAccessoryProps) {
  useTasksWebAccessRevision();
  if (!readTasksWebAccess(props.environmentId).canReadTasks) return props.fallback;
  const client = readTasksWebClient(props.environmentId);
  return <Counts {...props} client={client} store={threadRunCountsStore(client)} />;
}
