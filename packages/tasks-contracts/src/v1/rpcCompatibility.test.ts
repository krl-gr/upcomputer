import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { assert, test } from "vite-plus/test";

import {
  TasksGetRpc,
  TasksPageRpc,
  TasksSearchRpc,
  TasksThreadTasksRpc,
  TasksUpdateRpc,
} from "./rpc.ts";
import { TaskId, TaskRank, TaskRunCount, TaskTag, type Task } from "./tasks.ts";

/** The Task of tasks RPC version 11 (6fbd963115), as older clients and servers decode it. */
const V11Task = Schema.Struct({
  id: TaskId,
  rank: TaskRank,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  output: Schema.NullOr(Schema.String),
  status: TrimmedNonEmptyString,
  priority: Schema.NullOr(TrimmedNonEmptyString),
  createdBy: TrimmedNonEmptyString,
  assigneeAgentRunId: Schema.NullOr(TrimmedNonEmptyString),
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceRunId: Schema.NullOr(TrimmedNonEmptyString),
  rootThreadId: Schema.NullOr(ThreadId),
  parentTaskId: Schema.NullOr(TaskId),
  parentRunId: Schema.NullOr(TrimmedNonEmptyString),
  metadata: Schema.Unknown,
  tags: Schema.Array(TaskTag),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: Schema.NullOr(IsoDateTime),
  notBefore: Schema.NullOr(IsoDateTime),
  triggerChangedAt: IsoDateTime,
});
const V11TaskListItem = Schema.Struct({
  ...V11Task.fields,
  runCounts: Schema.Array(TaskRunCount),
  latestRunStatus: Schema.optional(Schema.NullOr(Schema.String)),
});
const V11Page = Schema.Struct({ tasks: Schema.Array(V11TaskListItem) });

const archivedAt = "2026-10-07T10:30:00.000Z";
const task: Task = {
  id: TaskId.make("task-1"),
  rank: TaskRank.make("0000000100000000"),
  projectId: ProjectId.make("project-1"),
  title: "Archived task",
  description: "",
  output: null,
  status: "Done",
  priority: null,
  createdBy: "user",
  assigneeAgentRunId: null,
  sourceThreadId: null,
  sourceRunId: null,
  rootThreadId: null,
  parentTaskId: null,
  parentRunId: null,
  metadata: null,
  tags: [],
  createdAt: "2026-10-07T10:00:00.000Z",
  updatedAt: "2026-10-07T10:00:00.000Z",
  archivedAt,
  notBefore: null,
  triggerChangedAt: "2026-10-07T10:30:00.000Z",
};
const listItem = { ...task, runCounts: [], latestRunStatus: null };

const encodeGet = Schema.encodeSync(TasksGetRpc.successSchema);
const encodeUpdate = Schema.encodeSync(TasksUpdateRpc.successSchema);
const encodePage = Schema.encodeSync(TasksPageRpc.successSchema);
const encodeSearch = Schema.encodeSync(TasksSearchRpc.successSchema);
const encodeThreadTasks = Schema.encodeSync(TasksThreadTasksRpc.successSchema);
const encodeV11Task = Schema.encodeSync(V11Task);
const decodeGet = Schema.decodeUnknownSync(TasksGetRpc.successSchema);
const decodeUpdate = Schema.decodeUnknownSync(TasksUpdateRpc.successSchema);
const decodePage = Schema.decodeUnknownSync(TasksPageRpc.successSchema);
const decodeV11Task = Schema.decodeUnknownSync(V11Task);
const decodeV11Page = Schema.decodeUnknownSync(V11Page);
const decodeV11Search = Schema.decodeUnknownSync(Schema.Struct({ tasks: Schema.Array(V11Task) }));

/** What crosses the wire: the encoded value after a JSON round trip. */
const wire = (encoded: unknown): unknown => JSON.parse(JSON.stringify(encoded));

test("a version 11 client decodes current task responses, with closedAt as the archive time", () => {
  assert.equal(decodeV11Task(wire(encodeGet(task))).closedAt, archivedAt);
  assert.equal(decodeV11Task(wire(encodeUpdate(task))).closedAt, archivedAt);
  assert.equal(decodeV11Task(wire(encodeGet({ ...task, archivedAt: null }))).closedAt, null);
  const page = decodeV11Page(
    wire(encodePage({ tasks: [listItem], nextCursor: null, statuses: ["Done"] })),
  );
  assert.equal(page.tasks[0]?.closedAt, archivedAt);
  const search = decodeV11Search(wire(encodeSearch({ tasks: [task] })));
  assert.equal(search.tasks[0]?.closedAt, archivedAt);
  const threadTasks = decodeV11Page(wire(encodeThreadTasks({ tasks: [listItem] })));
  assert.equal(threadTasks.tasks[0]?.closedAt, archivedAt);
});

test("the current client decodes a version 11 server's tasks, reading closedAt as archivedAt", () => {
  const { archivedAt: _archivedAt, ...rest } = task;
  const v11 = wire(encodeV11Task({ ...rest, closedAt: archivedAt })) as object;
  const decoded = decodeGet(v11);
  assert.deepStrictEqual(decoded, task);
  assert.notProperty(decoded, "closedAt");
  const page = decodePage({
    tasks: [{ ...v11, closedAt: null, runCounts: [] }],
    nextCursor: null,
    statuses: [],
  });
  assert.equal(page.tasks[0]?.archivedAt, null);
});

test("a current response round-trips to the same task", () => {
  assert.deepStrictEqual(decodeUpdate(wire(encodeUpdate(task))), task);
});
