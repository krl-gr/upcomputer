# Human tasks: integrating wande into the task system

Status: design, phase 0. Target branch: `feature/human-tasks` (from `next/v2`
at `6cdd2a7734`). Next step: independent review.

This document describes how the user's web task tracker wande
(`~/Projects/wande-app`, Next.js 15 + Convex) becomes the human side of the
existing task system (`packages/tasks-contracts`, `tasks-server`,
`tasks-web`). It runs locally on the server's SQLite. It is an extension of
the task system, not a second system: one `tasks` table, one RPC group, one
change stream, one MCP tool family.

Decisions the user already made are inputs here and are not reopened:
build on `next/v2`; one `tasks` table; projects are UpComputer projects with
an auto-created Inbox; the wande layout becomes the main `/tasks` view with
the table as a second mode; wande control placement with UpComputer styling;
Boards, the z.ai assistant, the bot API/CLI, billing, auth, landing and blog
are out of scope.

Paths below are relative to the core repo unless they start with `wande:`.

## 1. What exists today

### UpComputer (`next/v2`)

- `Task` (`packages/tasks-contracts/src/v1/tasks.ts`): `id`, `rank` (16 hex
  digits, one global order per environment, new tasks prepend), required
  `projectId`, `title`, `description`, `output`, free-form `status`,
  `priority`, `createdBy`, `assigneeAgentRunId`, origin fields, `metadata`,
  `tags`, `archivedAt` (archive is independent of status), `notBefore`,
  `triggerChangedAt`. There is no field saying who the task is for.
  `TaskActor` (person, server, agent-run, thread) appears only in history
  event payloads.
- `TaskUpdateInput` cannot change `projectId`. Wande needs that (the project
  chip on every row). See 3.4.
- Agent triggers: `startsForTask` in
  `packages/tasks-server/src/agents/TaskAgentService.ts:146`. An enabled agent
  starts when the project matches (or the agent has no project), the task is
  not archived, `notBefore` has passed, the status is in `startStatuses`
  (empty means any) and all `startTags` are present (empty means none
  required). An agent with neither statuses nor tags starts on every task.
  `startAgentRun` re-checks archive, `notBefore` and agent enablement inside
  the insert (`TaskRepositoryLive.ts:1117`).
- `triggerFieldsChanged` (`TaskRepositoryLive.ts:203`) decides which writes
  move `triggerChangedAt`: title, description, status, tags, `notBefore`,
  `archivedAt`.
- Storage: migrations `001` to `019` under
  `packages/tasks-server/src/persistence/migrations/`, registered in
  `index.ts` with owner/namespace `upcomputer.tasks`. No foreign keys:
  `deleteTask` deletes the task's tags and row in one transaction and keeps
  its events.
- Change stream: `TaskChange` (`kind`, `sequence`, `taskIds`, `listChanged`,
  `runsChanged`, `rootThreadIds`), published after commit through
  `withChanges` / `withChangeTransaction` on a sliding PubSub. Clients resync
  on a sequence gap (`packages/tasks-web/src/rpc/taskChanges.ts`).
- RPC: `TasksRpcGroup`, `TASKS_RPC_CONTRACT_VERSION = 12`
  (`packages/tasks-contracts/src/v1/rpc.ts`). Old wire shapes are kept
  decodable (`rpcCompatibility.test.ts`, the `closedAt` alias).
- Web feature availability is probed per environment by calling a method
  (`packages/tasks-web/src/environmentApi.ts:47`), not by reading the version
  number.
- Web: `/tasks` is `TasksRoute` -> `TasksView` (table + `DetailSidebar`),
  multi-environment (`ScopedTask` carries `environmentId`, reorder refuses
  cross-environment moves). Manual creation is hidden by
  `SHOW_MANUAL_CREATE_ACTIONS = false` (`ui/manualCreation.ts`), shared by
  the Tasks, Agents and Automations views. The create form defaults the
  status to `"new"`.
- UI primitives (`apps/web/src/components/ui`): base-ui based `dialog`,
  `alert-dialog`, `sheet`, `popover`, `menu`, `select`, `combobox`,
  `calendar` (`@daypicker/react`), `number-field`, `toggle-group`, `tooltip`,
  `scroll-area`, `table`, `textarea`, `input`, `switch`, `radio-group`,
  `toast`. No context-menu wrapper and no floating window.
- `apps/web` already depends on and uses `@dnd-kit/core` 6.3.1,
  `@dnd-kit/sortable` 10, `@dnd-kit/utilities` 3.2.2 and `@dnd-kit/modifiers`
  (the sidebar, `Sidebar.tsx:25`). The task brief said it is unused; that is
  not the case, which makes the dnd-kit decision easy (8.7).
- Tiptap 3 is present (composer only). Task descriptions are edited as a
  textarea and rendered with `ChatMarkdown` (`TasksView.tsx:838`).
- `docs/tasks/README.md` and `task-origins.md` exist only on `main`, not on
  `next/v2`. This document is the first file in `docs/tasks/` on this branch.
- Live data point (read with `agent_search`, 2026-10-07): the user's
  environment has 42 task agents, 5 enabled. All 42 have a project and every
  one requires at least one start tag. None is tag-less. Several disabled
  ones start on status `new`, wande's active status.

### wande

- Tables (`wande:convex/schema.ts`): `projects` (title, color, `order_num`,
  status active/archive), `tasks` and `routines` (identical shape: title,
  markdown `content`, float `order`, `project_id`, status
  `new | done | archive`), `dayQueues` (one per user and date, with an
  embedded `instances` array), `queueInstances` (rows rebuilt from the array
  on every write, with reminder columns), `userSettings`,
  `pushSubscriptions`. No due dates, priorities, tags or subtasks.
- Instances are stored twice. The embedded array is written; rows are a
  derived projection read by every query. Each instance copies `title`,
  `project_id` and `description` from its task; `dayQueues/sync.ts` rewrites
  the copies when a task changes. Deleting a task leaves orphaned instances.
- Instance done and task done are independent in both directions
  (`dayQueues/mutations.ts:238`, `sync.ts` ignores status). Instance status
  is `new | done | archived` (note: `archived`, not `archive`).
- Ordering: tasks use a float `order` with midpoints and no rebalance;
  instances use the array index.
- Reminders: a 1-minute cron claims due rows and sends web push
  (`convex/lib/pushReminders.ts`, `pushNotifications/*`).
- Client data: 11 files in `lib/queries/*`, about 110 hooks. By domain:
  tasks 15, routines 12, projects 7, day queues 27 (with aliases), settings
  3, boards 21, assistant 9, files 8, bot tokens 3, feedback 2, push 3.
  Optimistic updates use Convex `withOptimisticUpdate` (6 queue mutations, 2
  task mutations) plus local React state in `TaskManager.tsx` for list
  reorder and field edits.
- `usePaginatedQuery` status strings are checked in `TaskManager.tsx`
  (lines 130, 1013, 1018) and `RoutineManager.tsx`; `EntityList` only gets
  booleans.
- Vendored `vendor/dnd-kit` (same versions as npm) and `vendor/milkdown` (22
  packages, 7.20.0), aliased in `next.config.ts`. No patches are recorded.
  Milkdown is used only by the boards editor, which the task description
  editor reuses.

## 2. Model overview

| wande                                | UpComputer                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `tasks` row                          | `tasks` row with `audience = 'person'`, `kind = 'task'`                     |
| `routines` row                       | `tasks` row with `audience = 'person'`, `kind = 'routine'` (phase 4)        |
| `projects` row                       | an UpComputer project; no project means the Inbox project                   |
| `dayQueues` + `queueInstances`       | `task_schedule_entries` rows only                                           |
| instance title/description copies    | none: joined from `tasks` at read time                                      |
| task `order` (float)                 | task `rank` (existing global order)                                         |
| instance array index                 | entry `position` (rank string per date)                                     |
| status `new` / `done` / `archive`    | status `To Do` / `Done` / `archivedAt` set (status kept)                    |
| instance `new` / `done` / `archived` | entry `open` / `done` / `skipped`                                           |
| cron + web push                      | server sweeper + system notification (phase 4)                              |
| `userSettings`                       | client settings for view prefs; server settings for time zone and reminders |

## 3. Data model, migrations, Task contract

### 3.1 Who the task is for: `audience`

New column and contract field `audience: "agent" | "person"`.

- `agent`: today's behavior. Agents start on it by the trigger rules.
- `person`: work for the human. Status-only triggers never start on it (4.1).

`assigneeAgentRunId` stays what it is (the claim of a running run). It is not
reused: it names a run, exists only while a run is active, and is cleared
when the run ends. `createdBy` is provenance, not audience: an agent can
create a task for the human ("sign the contract") and a person can create a
task for agents.

Defaults on create:

| path                            | default                                                |
| ------------------------------- | ------------------------------------------------------ |
| `tasks.create` RPC (any client) | `agent`, so v12 clients keep their meaning             |
| planner create window           | sends `person`                                         |
| table view create form          | sends the value of a new "For" select, default `agent` |
| `task_create` tool              | `agent`; the tool description explains `person`        |
| automations                     | `agent` (a template field is a later, separate change) |

### 3.2 Routines: `kind`

New column and field `kind: "task" | "routine"`, default `task`. A routine is
a person task that is planned repeatedly and whose progress counts per week.

Constraint: `kind = 'routine'` requires `audience = 'person'` (SQL `CHECK`
and contract validation in the service). Routines never start agents.

Alternatives considered:

- A separate `routines` table (wande's model). Rejected: duplicates every
  task query, RPC and tool, and schedule entries would need a polymorphic
  reference again (wande's `entity_type` + string `entity_id`).
- A tag (`routine`). Rejected: tags are trigger inputs and are user-editable
  free text; a reserved tag would leak into trigger semantics.
- A status (`Routine`). Rejected: wande routines have their own
  active/done/archive lifecycle, so status is already in use.
- `metadata.kind`. Rejected: needs an index for list filtering and a
  constraint for safety.

"Never closes" from the brief is not quite wande's behavior: a wande routine
can be done or archived. Routines here keep the normal status and archive
behavior; they just never trigger and are listed separately.

The column lands in phase 1 (one migration, one contract change, and the
trigger gate in one place), but nothing creates routines before phase 4.

### 3.3 Migration 020: `TaskAudienceAndKind`

```sql
ALTER TABLE tasks ADD COLUMN audience TEXT NOT NULL DEFAULT 'agent'
  CHECK (audience IN ('agent', 'person'));
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'
  CHECK (kind IN ('task', 'routine'));
-- SQLite cannot add a table CHECK spanning two columns with ALTER TABLE.
-- The kind/audience rule is enforced by a trigger:
CREATE TRIGGER tasks_routine_is_person_insert BEFORE INSERT ON tasks
  WHEN NEW.kind = 'routine' AND NEW.audience <> 'person'
  BEGIN SELECT RAISE(ABORT, 'routines are person tasks'); END;
CREATE TRIGGER tasks_routine_is_person_update BEFORE UPDATE OF kind, audience ON tasks
  WHEN NEW.kind = 'routine' AND NEW.audience <> 'person'
  BEGIN SELECT RAISE(ABORT, 'routines are person tasks'); END;
CREATE INDEX tasks_audience_kind_rank ON tasks(audience, kind, rank);
```

It also recreates `task_list_update` (last done in `019_TaskArchive.ts`) so
that `audience`, `kind` changes bump the list revision, because they change
which filtered lists a task belongs to.

Every existing task becomes `agent` / `task`: no behavior change on upgrade.

### 3.4 Task contract changes (`tasks.ts`)

- `Task`: add `audience` and `kind`. On the wire both are decoded as optional
  with defaults `agent` / `task`, so a v13 client decodes a v12 server's
  tasks. v12 clients ignore the extra keys. `rpcCompatibility.test.ts` gets
  both directions.
- `TaskCreateInput`, `TaskToolCreateInput`: optional `audience`, `kind`, and
  an optional placement `beforeTaskId` / `afterTaskId` for wande's "Create
  task above/below". Without placement a new task prepends, as today and as
  wande does.
- `TaskUpdateInput`: optional `audience`, `kind`, and `projectId`. Moving a
  task between projects is new. An agent with a project starts only on that
  project's tasks, so a project change can start agents: `projectId` joins
  `triggerFieldsChanged`. `audience` and `kind` join it too.
- `TaskSearchInput` / `TaskPageInput`: optional `audience`
  (`agent | person | all`, default `all` for RPC), `kind` (default `task`
  when absent, so routines do not appear in existing lists), and
  `excludeStatuses` (array, max 20). The wande active list is
  `audience=person, archive=active, excludeStatuses=["Done"]`.
- New `TaskReorderManyInput { ids (1..500), beforeTaskId? | afterTaskId? }`:
  moves several tasks as a block in their current relative order, in one
  transaction. Needed for select mode "Move tasks to top" and "Move tasks
  under...". The single `reorder` stays.
- `TaskChange`: optional `scheduleDates: string[]` (5.2).

### 3.5 Status vocabulary

`v2` has no fixed status set. The documented workflow is `Backlog`,
`To Do`, `In Progress`, `Needs Review`, `Done`; the table view's sort list
also has lowercase `new`, `closed` and others; the table create form
defaults to `"new"`.

Person tasks use two constants in `tasks-contracts`:
`PERSON_OPEN_STATUS = "To Do"` and `PERSON_DONE_STATUS = "Done"`.

- Wande's Done button sets `Done`; Restore sets `To Do`.
- Any status other than `Done` counts as active in the planner list and is
  shown as a status label next to the chips (for example `Needs Review` after
  an agent helped).
- Archive is `tasks.archive` (sets `archivedAt`, keeps status), exactly as
  for agent tasks. Wande's archive view shows "done or archived"; the planner
  merges two pages for it (`status=Done, archive=active` and
  `archive=archived`), which is what wande itself does with two paginated
  queries.
- Mapping wande `new` to `To Do` is safe with the trigger rule in 4.1 even
  though every enabled agent starts on `To Do`: person tasks need a tag
  addressed to an agent.

### 3.6 Migration 021: `TaskScheduleEntries`

```sql
CREATE TABLE task_schedule_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  date TEXT NOT NULL,                -- YYYY-MM-DD, the person's calendar day
  position TEXT NOT NULL,            -- 16 hex digits, order within the date
  start_time TEXT,                   -- HH:MM wall-clock time, null = untimed
  duration_minutes INTEGER,          -- null = use the client default
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('open', 'done', 'skipped')),
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
  CHECK (start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]')
);
CREATE UNIQUE INDEX task_schedule_entries_date_position
  ON task_schedule_entries(date, position);
CREATE INDEX task_schedule_entries_task_date
  ON task_schedule_entries(task_id, date);
```

- No copied title, project or description. Reads join `tasks`.
- No embedded array, no second copy. Rows are the only storage.
- No foreign key, following the existing schema. `deleteTask` deletes the
  task's entries in the same transaction as its tags (fixes wande's orphans).
- `position` reuses `taskRankBetween` / `rebalancedTaskRanks` from
  `persistence/taskRank.ts` scoped to one date. A day holds a handful of
  entries, so a rebalance rewrites only that day.
- Reminder columns (`remind_at`, `reminder_sent_at`) are not added now. They
  arrive with the feature in phase 4 (migration 022) rather than as unused
  columns, since their computation depends on the time-zone setting decided
  there.

## 4. Agent trigger safety

### 4.1 Rules

`startsForTask` gains two checks before the existing ones:

```ts
if (task.kind === "routine") return false;
if (task.audience === "person" && agent.startTags.length === 0) return false;
```

In words:

1. A routine never starts an agent.
2. A person task never starts an agent that has no start tags. Status-only
   triggers ("any task in To Do") and catch-all agents (no statuses, no
   tags) ignore person tasks completely.
3. A person task starts an agent only when the task carries every one of that
   agent's start tags and the other rules (status, project, archive,
   `notBefore`, re-run rule) match. Adding the tag is the explicit hand-off
   the brief asks for. The task stays the person's.
4. Setting `audience` to `agent` is the other explicit hand-off: from then on
   every rule applies as for any agent task. It is a trigger change
   (`triggerFieldsChanged`), so a matching agent starts at once, like an
   unarchive.
5. Setting `audience` back to `person` does not stop runs that already
   started, consistent with "a started run keeps running while the task's
   status and tags change". The person stops a run with the existing stop
   action. (Open question 3.)

The same check goes into the `startAgentRun` insert guard so a race with an
audience or kind change cannot start a run:

```sql
AND EXISTS (SELECT 1 FROM tasks WHERE id = :taskId AND kind = 'task'
  AND (audience = 'agent' OR (SELECT json_array_length(start_tags_json)
       FROM task_agents WHERE id = :agentId) > 0))
```

Run-status agents (`startRunStatuses`) go through `startsForTask`, so they
inherit the same gate.

Agent-made hand-offs keep the existing start ceiling: when an agent run flips
`audience` or adds a tag, `scheduleTaskChanged` carries the caller's
`startCeiling`, and an agent broader than the caller is refused, as for
status and tag changes today.

### 4.2 Existing agents

- Agents with tags: unchanged on agent tasks; on person tasks they start only
  when someone adds their tag. In the user's environment that is all 42.
- Tag-less agents (none in the user's environment, possible elsewhere):
  unchanged on agent tasks; never start on person or routine tasks.
- All existing tasks migrate to `agent`, so nothing changes on upgrade.
- The brief also asked about "existing agents with tag-less status
  triggers": a person task in `To Do` never starts them, which is the point
  of rule 2.

### 4.3 Scheduler costs that grow with human tasks

Wande users have thousands of tasks. Three places iterate over all tasks and
would now include them:

- `reconcileAgent` and `recover` call `listAllTasks()` and test every task
  against every agent. Phase 1 adds `listTriggerCandidates()`: unarchived
  `kind = 'task'` tasks that are `agent`, or `person` with at least one tag.
- `startAgent` computes the prompt's "global position N of M" from
  `listAllTasks()`. It should count agent tasks only; person tasks are not
  in an agent's queue.

### 4.4 Rule text

`TASK_TRIGGER_RULES` (`tools/TaskToolDefinitions.ts:37`), which agents read
through `task_context`, gets one new rule:

> A task is for agents or for a person (audience). Person tasks and routines
> are the user's own work: an agent never starts on them by status alone.
> An agent starts on a person task only when the task has every one of the
> agent's start tags, or after its audience is set to agent.

`docs/tasks/README.md` (on main) gets the same rule when this lands.

## 5. Schedule semantics

An entry says "the person plans to work on this task on this day", optionally
at a time for a duration. A task can have any number of entries, including
several on one day (wande allows it: two sessions).

### 5.1 Ordering

- Queue view: entries of a date ordered by `position`.
- Calendar view: timed entries placed by `start_time`; untimed entries are not
  shown in the calendar grid (as in wande, which has no all-day row).
- New entries: at the bottom by default; a drop onto an entry inserts before
  it; explicit `at: top | bottom`, `before: entryId`, `after: entryId`.
- Several entries moved or copied together keep their relative order (by
  current date, then position).

### 5.2 Operations

| operation | effect                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------ |
| add       | new entries for one or more tasks on a date at a placement, optional time and duration, status `open`  |
| update    | patch `status`, `startTime`, `durationMinutes`; `null` clears a timing field                           |
| move      | same ids, new date and placement; optional new `startTime` / `durationMinutes`; status kept            |
| copy      | new ids on one or more dates at a placement; status `open`; time and duration kept                     |
| delete    | remove entries                                                                                         |
| moveOpen  | "Reschedule incomplete": every `open` entry of `fromDate` moves to the bottom of `toDate` in its order |

Calendar drops (move with a `startTime`) place the entry before the first
entry of that day whose start time is later, and after untimed entries keep
their place. Wande instead re-sorts the whole target day by time, which
reorders untimed entries the person arranged by hand. This is a deliberate
deviation (open question 14).

`moveOpen` takes an explicit `toDate`. Wande hard-codes "tomorrow relative to
today", not the column's next day; the client keeps that behavior by passing
tomorrow.

Every write runs inside `withChangeTransaction` and publishes one
`TaskChange` with `scheduleDates` (every date whose entries changed, both
source and target) and `taskIds` (the tasks whose entries changed, so
progress chips refresh). `listChanged` stays false for schedule-only writes.

### 5.3 Entry state vs task state

An entry never changes its task; a task's state change moves its entries.
This differs from wande, where both stay independent: the task can be closed
from anywhere (an agent's `task_update`, the table, another client), and an
open entry of a closed task left the plan looking unfinished.

- Marking an entry done means "that session happened". The task keeps its
  status. A task worked on over several days has several done entries and
  stays `To Do` until the person marks it done.
- The task becoming `Done`, by any write: its open entries up to today become
  done, open entries on later dates are deleted. "Today" is the date in the
  schedule's time zone (5.4).
- The task leaving `Done` for work: only today's entry that became done with
  it, and was not changed since, is open again. Its history event of becoming
  `Done` gives the time to match.
- The task cancelled (status `Cancelled` or `Canceled`) or archived: its open
  entries become skipped. Unarchiving moves nothing.
- Deleting a task deletes its entries.
- Routines are left alone: their entries follow the day, not the task.
- Entry cards still render the joined task state, so an entry of a done or
  archived task is struck through whatever its own status.
- `skipped` (wande's instance `archived`) means "planned but not done, and
  not carried over". It counts as handled in progress, as in wande
  (`done | archived` over total).
- Progress for a task: handled entries / all entries. For a routine: the same
  over the current week (week start from settings), as wande's
  `queueProgress.ts`.

Agent tasks can be scheduled too: the person can put "review the agent's
result" on a day. The planner list's "Agents" filter (phase 3) makes them
reachable for dragging.

### 5.4 Dates and time zones

`date` and `start_time` are wall-clock values in the person's time zone and
are stored without a zone, as wande does. Nothing in phases 1 to 3 converts
them to instants. Phase 4 needs an instant for reminders and adds a server
setting `scheduleTimeZone` (IANA, default the server's zone) used to compute
`remind_at` (open question 8).

## 6. RPC and MCP surface

### 6.1 Service layer

A new `TaskScheduleService` (`packages/tasks-server/src/schedule/`) holds the
logic. RPC handlers and tools both call it, so agents reach exactly what the
UI does (root `AGENTS.md`: a capability is a service method, not handler
code). SQL lives in the repository (new `scheduleQueries.ts` used by
`TaskRepositoryLive`, sharing its transaction and change bus).

### 6.2 RPC (tasks group, version 13)

Reads (read scope):

- `scheduleRange({ from, to })`, at most 62 days:
  `{ entries: TaskScheduleEntry[], tasks: TaskListItem[] }`. `tasks` holds
  every task referenced by the entries, once. This is the join; nothing is
  copied in storage.
- `scheduleForTask({ taskId, limit?, cursor? })`: the task's entries by date,
  start time, position, for the detail window's schedule list.
- `scheduleProgress({ taskIds (max 500), from?, to? })`:
  `{ progress: { taskId, total, handled }[] }`, for list chips.

Writes (operate scope), each returning the changed entries:

- `scheduleAdd({ taskIds, date, placement?, startTime?, durationMinutes? })`
- `scheduleUpdate({ id, status?, startTime?, durationMinutes? })`
- `scheduleMove({ ids, date, placement?, startTime?, durationMinutes? })`
- `scheduleCopy({ ids, dates, placement? })`
- `scheduleDelete({ ids })`
- `scheduleMoveOpen({ fromDate, toDate })`

Task methods changed or added: `create` (audience, kind, placement),
`update` (audience, kind, projectId), `page` / `search` (audience, kind,
excludeStatuses), new `reorderMany`.

`TASKS_RPC_CONTRACT_VERSION` becomes 13. The web probes `scheduleRange` the
first time the planner opens for an environment, in the same way
`environmentApi.ts` probes the group with `runCounts`. A server without it
gets the table view only, with a note.

`placement` is `{ at: "top" | "bottom" } | { before: EntryId } |
{ after: EntryId }`, validated against the target date.

### 6.3 MCP tools (phase 3)

Added to `TASK_TOOL_SPECS`, so they appear on the core MCP endpoint and in
the dynamic tools:

| tool                   | mutation | input                                                             |
| ---------------------- | -------- | ----------------------------------------------------------------- |
| `task_schedule_get`    | read     | `from`, `to` (or `taskId`)                                        |
| `task_schedule_add`    | write    | `taskIds`, `date`, `startTime?`, `durationMinutes?`, `placement?` |
| `task_schedule_update` | write    | `id`, `status?`, `startTime?`, `durationMinutes?`                 |
| `task_schedule_move`   | write    | `ids`, `date`, `startTime?`, `placement?`                         |
| `task_schedule_delete` | write    | `ids`                                                             |

Copy and moveOpen stay UI-only until an agent use case appears.

Existing tools: `task_create` / `task_update` accept `audience` (and later
`kind`); `task_search` accepts `audience`. Read-only modes deny the writes
through the existing `mutationPolicy`. Task-agent runs may write the
schedule: scheduling things for the person is the purpose. `task_context`
promptGuidance gets a line: schedule person tasks for the user only when
asked or when the task says so.

`task_search` default audience for tools: `agent` (open question 2). Agents
today find their queue with status and tag filters; person tasks should not
appear there unless asked for.

## 7. Projects and the Inbox

- Every task keeps a required `projectId`. The planner shows the project icon
  (`ProjectIconCell` already exists in tasks-web), no colors. Wande colors
  are dropped; a project color is a possible later core change.
- The planner's project select lists the environment's projects plus Inbox.
  Wande's "Unassigned" maps to Inbox.
- Inbox: a normal project titled "Inbox" on a service folder
  `<T3 home>/tasks-inbox`, created lazily the first time a person task is
  created without a project (planner, tool, or import). Its id is stored in a
  one-row tasks setting, so renaming the project does not break the lookup.
  If the project was deleted, the next need recreates it.
- tasks-server cannot create projects today: `ProjectService` is not exported
  from `apps/server/src/extensionApi.ts`. Phase 1 adds the smallest core
  extension point: export a narrow `ensureProjectForWorkspaceRoot`
  (`title`, `workspaceRoot`) built on `ProjectService.bootstrap`, plus the home
  directory from `ServerEnvironment` (already exported).
- Wande's Projects tab (folders/columns views, project detail) is dropped:
  UpComputer projects are managed in the sidebar (open question 12).

## 8. Web architecture

### 8.1 Placement in the app

- `/tasks` gets a view switch in the `WorkspaceViewLayout` toolbar:
  Planner (default) and Table (today's `TasksView`, unchanged). The choice is
  in the URL search (`view=table`) and remembered in local storage.
- Agents and Automations pages are unchanged. `SHOW_MANUAL_CREATE_ACTIONS`
  becomes per view: on for Tasks, still off for Agents and Automations.
- The planner shows one environment at a time: the primary environment by
  default, with an environment select when more than one serves Tasks.
  Schedule order lives in one environment's SQLite; a day merged from
  several environments has no defined order (open question 5). The table
  view stays multi-environment.
- New code lives in `packages/tasks-web/src/planner/`. The only edits to
  existing files are the view switch in `TasksRoute.tsx`, the
  `manualCreation.ts` split, the RPC client methods, and new deps in
  `package.json`. Nothing in `apps/web` changes except, if needed, exporting
  an existing helper.
- Mobile has no Tasks UI today; the planner is web and desktop only.

### 8.2 Data layer

Wande's components read through hooks with Convex semantics: `undefined`
while loading, live updates, paginated status strings. The port keeps that
contract for the hooks it needs, implemented over our RPC and change stream.

`planner/data/plannerStore.ts`, one store per environment
(`useSyncExternalStore`):

- `tasks`: `Map<TaskId, TaskListItem>`, filled from list pages,
  `scheduleRange.tasks` and `items`.
- `lists`: the active list and the two done/archived lists, each a
  `TaskPageLoader` (reused from `state/taskPageLoader.ts`).
- `entries`: entries by date for the loaded date windows.
- `progress`: by task id, for mounted rows.

It subscribes to the environment's shared change subscription
(`createTaskChangeSubscription`) and, batched at 150 ms like
`TaskPageLoader`:

- `taskIds` -> refetch those tasks with `items` (title or status edits show in
  entries through the join), and their progress;
- `scheduleDates` -> refetch the loaded windows that contain them;
- `listChanged` -> refresh list pages;
- `sync` or a sequence gap -> refetch everything loaded.

No polling. Hooks kept, with wande names so ported components change little:

| domain             | hooks                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tasks              | `useActiveTasksPaginated`, `useArchivedTasksPaginated`, `useTaskById`, `useTasksByIds`, `useCreateTask`, `useUpdateTask`, `useBulkUpdateTasks`, `useDeleteTask`, `useBulkDeleteTasks`, `useReorderTasks` (replaces `useUpdateTaskOrder`)                                                                                                                                               |
| schedule           | `useDayQueues(start, end)`, `useQueueInstancesByEntityId`, `useQueueProgressByEntityIds`, `useAddQueueInstance`, `useBulkCreateQueueInstances`, `useUpdateQueueInstanceTiming`, `useUpdateQueueInstanceStatus`, `useDeleteQueueInstance`, `useBulkDeleteQueueInstances`, `useBulkMoveQueueInstances`, `useBulkCopyQueueInstances`, `useScheduleQueueInstances`, `useMoveOpenInstances` |
| projects           | `useProjects` (core projects, read-only)                                                                                                                                                                                                                                                                                                                                               |
| settings           | `useSettings`, `useUpdateSettings` (8.6)                                                                                                                                                                                                                                                                                                                                               |
| routines (phase 4) | the task hooks with `kind: "routine"`                                                                                                                                                                                                                                                                                                                                                  |

About 30 hooks. The other 80 belong to dropped features (boards, assistant,
files, bot tokens, feedback, push) or are unused in wande
(`useSyncQueueInstances`, `useUpdateDayQueue`, `useMoveInstancesToTomorrow`
stub).

`useDayQueues` returns wande's `DayQueue` shape (`{ date, instances }`) built
from rows plus the joined task, so components keep reading
`instance.title`. The derived title is never written back.

Paginated hooks return `{ results, status, loadMore }` with Convex's status
strings (`LoadingFirstPage`, `CanLoadMore`, `LoadingMore`, `Exhausted`)
derived from `TaskPageLoader` state, because `TaskManager` checks them.
Page sizes follow wande: 40 active, 30 done/archived.

Bulk task writes (select mode project and status) loop over `update` on the
client, one call per task. `reorderMany` is a server method because the
block must keep its order atomically (open question 9).

### 8.3 Optimistic updates

Convex's `OptimisticLocalStore` is replaced by a pending-op overlay in the
store:

```ts
interface PendingOp {
  readonly id: number;
  readonly apply: (state: PlannerState) => PlannerState; // pure
}
view = pending.reduce((state, op) => op.apply(state), serverState);
```

- On mutate: push the op, call the RPC.
- On success: merge the returned rows (entries or tasks) into `serverState`
  and drop the op. Merging uses a per-row version guard: a row from a
  refetch replaces a stored row only when its `updatedAt` is not older.
  Deleted ids keep a tombstone until a refetch that started after the
  response completes, so an in-flight stale read cannot resurrect them.
- On failure: drop the op and show a toast (`toastManager`).

The `apply` functions are wande's own pure helpers, ported:
`lib/dayQueueOptimistic.ts` (add, move, schedule on a `DayQueue[]`) and
`lib/entityListOptimistic.ts` (patch merge, id order). This covers every
place wande is optimistic: list reorder, field edits and done toggles,
queue add/move/copy/schedule, timing drag and resize, entry status.

### 8.4 Floating windows and drafts

- `planner/windows/windowStore.ts`: module-level per environment, so open
  windows survive leaving `/tasks` and coming back (wande keeps them across
  tabs; the spec requires it). Entries hold
  `kind` (`create` or `detail`), `id`, `taskId`, `z` and `position`; one detail window per task, unlimited create
  windows; focus raises z.
- `FloatingWindow`: our own component (upstream has none), a portal with the
  popup surface classes from `dialog-styles.ts`, dragged by its header,
  clamped to the viewport, not resizable, as in wande. Below the `md`
  breakpoint windows render as a bottom `Sheet`, as in wande.
- Drafts (`TaskDraftsContext`) become a module-level map keyed by task id;
  the description is saved on close, the title on blur, project and status
  at once, as in wande.

### 8.5 Component mapping

| wande                                                                                 | UpComputer                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| shadcn `Dialog`, `custom-dialog`                                                      | `ui/dialog`                                                                |
| confirm dialogs (delete)                                                              | `ui/alert-dialog`                                                          |
| `Sheet`                                                                               | `ui/sheet`                                                                 |
| `Popover` (+ `PopoverAnchor` virtual ref)                                             | `ui/popover` (base-ui anchors accept a virtual element)                    |
| `Select`                                                                              | `ui/select`                                                                |
| custom portal `context-menu.tsx`                                                      | base-ui `ContextMenu` styled with `ui/menu` parts, in `planner/ui/`        |
| three-dots menus (custom)                                                             | `ui/menu`                                                                  |
| `Calendar`, `date-picker` (react-day-picker 9)                                        | `ui/calendar` (`@daypicker/react`)                                         |
| `MultiSectionTimePicker`                                                              | our `TimeField` in `planner/ui/`: `ui/input` time entry plus a preset list |
| duration number field                                                                 | `ui/number-field`                                                          |
| duration presets select                                                               | `ui/select`                                                                |
| `Button`, `Input`, `Textarea`, `Label`, `Switch`, `RadioGroup`, `ScrollArea`, `Table` | same-named `ui/*`                                                          |
| native `title` tooltips                                                               | `ui/tooltip`                                                               |
| `sonner` toasts                                                                       | `ui/toast` (`toastManager`)                                                |
| `FloatingWindow`                                                                      | our `planner/ui/FloatingWindow.tsx` (8.4)                                  |
| `ResizableLayout` (list width, stacked mobile panes)                                  | our `planner/ui/PlannerLayout.tsx`                                         |
| Days shown 1/2/3/7, Queue/Calendar                                                    | `ui/toggle-group` inside the header popover                                |
| Milkdown description editor                                                           | `ui/textarea` with `ChatMarkdown` preview (8.7)                            |
| `WikiInlineRenderer`                                                                  | plain text (wiki links point at boards and files, which are dropped)       |
| lucide icons                                                                          | lucide icons (already used)                                                |

Tailwind classes are not copied; spacing, color and type come from the
existing tokens. Layout structure (what sits where) is copied. `ui/*`
components are used through their `variant` and `size` only (the
`shadcn/no-restyle` lint rule); looks that belong to the planner, such as the
entry card or the floating window, live in the planner's own components.

### 8.6 Where each control lives

Positions are wande's. The planner has no page toolbar: the list header and
the week header side by side are its title bar row (both `WorkspacePageHeader`).

| control                                                              | wande location                          | planner location                                          |
| -------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| Planner / Table switch                                               | none                                    | list header, left, icons (the table's toolbar: names)     |
| project filter                                                       | none (wande has no list filters)        | none for now (the table keeps it)                         |
| Tasks / Routines (phase 4)                                           | top-level tabs                          | list header, after Planner / Table (a select when narrow) |
| Mine / Agents / All (phase 3)                                        | none                                    | list header, a select after Tasks / Routines              |
| environment select                                                   | none                                    | list header menu, only with more than one environment     |
| New Task                                                             | list header, left                       | list header, right, `+`                                   |
| Select (mode)                                                        | list header, right                      | list header menu                                          |
| Archive view toggle                                                  | list header, right                      | list header menu, Show archive                            |
| right-pane hide/show                                                 | list header, right (lg and up)          | list header, right (planner 768px wide and up)            |
| select-mode count, bulk project/status/add-to-queue, bulk menu, exit | list header in select mode              | same                                                      |
| title (click to edit, Enter saves)                                   | row                                     | row                                                       |
| project chip                                                         | row metadata                            | row metadata, icon + name                                 |
| Done / Archive / Restore                                             | row metadata                            | row metadata                                              |
| status label for other statuses                                      | none                                    | row metadata (new: agent-set statuses)                    |
| Add to queue                                                         | row metadata (queue mode, day selected) | same                                                      |
| schedule chip `done/total`                                           | row metadata                            | same                                                      |
| open details, more actions                                           | row, right                              | row, right                                                |
| context menu (create above/below, move to top, move below, delete)   | right-click or three dots               | same                                                      |
| Load more, bottom drop zone                                          | list footer                             | same                                                      |
| month/year, `<< < Today > >>`                                        | week header                             | right pane header                                         |
| Go to date, Select items, Days shown, View                           | week header three-dots popover          | same                                                      |
| selection header Move / Copy / Delete                                | week header in select mode              | same                                                      |
| day header click (target day for Add to queue)                       | day column header                       | same                                                      |
| Reschedule incomplete, Set time & duration                           | day header hover menu                   | same                                                      |
| entry done toggle, three-dots menu, click opens task                 | entry card                              | same                                                      |
| calendar drag to time, resize handle                                 | calendar card                           | same                                                      |
| window title, "..." menu, X save-and-close                           | window header                           | same                                                      |
| metadata chips, description/instances switch                         | window body                             | same                                                      |
| schedule table (date, start, duration, status, delete), Add instance | detail window instances view            | same                                                      |
| Create / Cancel                                                      | create window footer                    | same                                                      |
| default duration, week start, card variant, counters                 | Settings tab                            | planner settings popover in the right pane header (8.6.1) |

#### 8.6.1 Settings

Wande `userSettings` split:

- View state that wande already kept per device in local storage (start
  date, days shown, list width, right pane hidden, scroll positions, slot
  height): local storage keys under `tasks.planner.*`.
- Preferences wande synced (`weekViewMode`, `weekStartDay`,
  `defaultTaskDuration`, `defaultRoutineDuration`, `queueInstanceVariant`,
  `showTaskListQueueCounter`): local storage in phase 2 (open question 11).
- `timeZone`, reminders on/off and lead minutes: server, phase 4.
- Board, assistant and calendar cross-visibility flags: dropped.

### 8.7 Drag and drop and the editor

- dnd-kit: use the npm packages `apps/web` already resolves
  (`@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10, `@dnd-kit/utilities`
  ^3.2.2), declared in `tasks-web/package.json`. No `vendor/`, no aliases.
  Wande's vendored copies match these versions and carry no recorded patch;
  phase 2 diffs them against npm once to confirm. Sensors and collision
  detection as wande: mouse distance 8, touch delay 150 / tolerance 8,
  keyboard, `pointerWithin`; one `DndContext` for list, queue and calendar.
- Description: textarea plus `ChatMarkdown` preview, as `TasksView` does.
  Milkdown (22 packages) is not brought in. Agents write task descriptions
  in markdown too, so one renderer for both is a plus. Tiptap is available if
  a rich editor is wanted later (open question 10).

## 9. Ported, rewritten, dropped

| wande                                                                                                                   | fate                                             | notes                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `lib/calendar/{types,time,layout,projection}.ts`                                                                        | ported                                           | pure; types retargeted to our entry type                      |
| `lib/calendarUtils.ts`, `lib/timeFormat.ts`                                                                             | ported                                           | pure (`date-fns` dep moves with them, or replace with `Intl`) |
| `lib/queueInstanceTime.ts`, `lib/queueProgress.ts`                                                                      | ported                                           | pure                                                          |
| `lib/dayQueueOptimistic.ts`, `lib/entityListOptimistic.ts`                                                              | ported                                           | become overlay `apply` functions                              |
| `lib/entityOrderUtils.ts`, `lib/utils.ts` `calculateOrderBetween`                                                       | dropped                                          | the server owns ranks (`reorder`, `reorderMany`)              |
| `lib/projectOrder.ts`                                                                                                   | dropped                                          | project order is the sidebar's                                |
| `lib/convexIds.ts`                                                                                                      | dropped                                          |                                                               |
| `convex/lib/pushReminders.ts`                                                                                           | ported to the server, phase 4                    | `computeReminderFields` logic, without web push               |
| `convex/dayQueues/sync.ts`, `queueInstanceSync.ts`                                                                      | dropped                                          | no copies to sync                                             |
| `convex/dayQueues/mutations.ts`                                                                                         | rewritten                                        | `TaskScheduleService`                                         |
| `convex/tasks/*`                                                                                                        | rewritten                                        | existing task methods plus 3.4                                |
| free-plan limits, paywall                                                                                               | dropped                                          |                                                               |
| `lib/queries/*`                                                                                                         | rewritten                                        | about 30 hooks over the store (8.2)                           |
| `TaskManager`, `EntityList`, `EntityItem*`, `TitleArea`, `EntityMetadataInputs`, `BulkContextMenu`, `EntityContextMenu` | rewritten                                        | same structure and placement, our primitives                  |
| `week-queue/*`, `week-calendar/*`, `useWeekQueueDnd`, `DraggableEntity`, `QueueInstance`, `QueueDayColumn`              | rewritten                                        | same behavior, our primitives                                 |
| `TaskDetailWindow`, `CreateTaskWindow`, `TaskEditorFields`, `QueueInstancesList`, `TaskEditorSheet`                     | rewritten                                        |                                                               |
| `FloatingWindow`, `ResizableLayout`                                                                                     | rewritten                                        | our files                                                     |
| `RoutineManager` and routine windows                                                                                    | rewritten, phase 4                               | same components with `kind`                                   |
| boards, assistant, files, bot API/CLI, billing, auth, landing, blog, feedback, Projects tab                             | dropped                                          | per the user's scope; Projects tab per open question 12       |
| `vision-script/*`                                                                                                       | kept as the behavior spec for phase 2 acceptance | not copied into the repo                                      |

## 10. Phases: files and tests

### Phase 1: server

Files:

- `packages/tasks-contracts/src/v1/tasks.ts`: `audience`, `kind`, inputs,
  filters, `TaskReorderManyInput`, `TaskChange.scheduleDates`, status
  constants.
- `packages/tasks-contracts/src/v1/schedule.ts` (new): entry, placement,
  inputs, results.
- `packages/tasks-contracts/src/v1/rpc.ts`, `index.ts`: methods, version 13.
- `packages/tasks-server/src/persistence/migrations/020_TaskAudienceAndKind.ts`,
  `021_TaskScheduleEntries.ts`, `index.ts`.
- `packages/tasks-server/src/persistence/TaskRepository.ts`,
  `TaskRepositoryLive.ts`, `scheduleQueries.ts` (new): columns, filters,
  `reorderMany`, entry storage, cascade in `deleteTask`,
  `listTriggerCandidates`, `triggerFieldsChanged` additions.
- `packages/tasks-server/src/schedule/TaskScheduleService.ts` (new).
- `packages/tasks-server/src/agents/TaskAgentService.ts`: the 4.1 gate, the
  candidate list, agent-only global position.
- `packages/tasks-server/src/rpc/contributions.ts`: handlers and scopes.
- `packages/tasks-server/src/tools/TaskToolDefinitions.ts`,
  `TaskToolService.ts`: `audience` on `task_create` / `task_update` /
  `task_search`, the new trigger rule. (Schedule tools wait for phase 3.)
- `packages/tasks-server/src/inbox/InboxProject.ts` (new) and the narrow
  export in `apps/server/src/extensionApi.ts`.

Tests (focused, `vp test run <files>`):

- Trigger semantics (`TaskTriggerSemantics.test.ts`): a person task in a
  start status never starts a tag-less agent or a catch-all agent; it starts
  a tagged agent once the tag is added; flipping `audience` to `agent`
  starts a status-only agent; flipping back does not stop it; routines never
  start anything; `projectId` change is a trigger change; the insert guard
  refuses a start after a concurrent flip.
- Migration: existing rows become `agent` / `task`; the routine/person
  triggers reject bad rows; list revision bumps on audience/kind change.
- Schedule repository: add at each placement; move within and across days
  keeps ids, status and relative order; copy to several dates; moveOpen
  moves only open entries; position rebalance within a day; delete task
  removes entries; each write publishes one change with the right
  `scheduleDates` and `taskIds`; a calendar drop inserts by time without
  reordering untimed entries.
- RPC compatibility: v12 task shapes decode with defaults; v13 tasks decode
  in a v12 schema; `TaskChange` with `scheduleDates` decodes in v12.
- Page filters: `audience`, `kind`, `excludeStatuses`; `reorderMany` keeps
  block order.
- Inbox: created once, reused, recreated after deletion.

### Phase 2: web planner

Files (all new unless noted), under `packages/tasks-web/src/planner/`:

- `logic/*`: ported pure modules (section 9) with their tests.
- `data/plannerStore.ts`, `data/hooks.ts`, `data/pendingOps.ts`.
- `windows/windowStore.ts`, `windows/draftStore.ts`.
- `ui/PlannerView.tsx`, `ui/PlannerLayout.tsx`, `ui/TaskList.tsx`,
  `ui/TaskRow.tsx`, `ui/TaskContextMenu.tsx`, `ui/BulkActions.tsx`,
  `ui/WeekHeader.tsx`, `ui/WeekQueue.tsx`, `ui/QueueDayColumn.tsx`,
  `ui/QueueEntryCard.tsx`, `ui/WeekCalendar.tsx`, `ui/CalendarDayColumn.tsx`,
  `ui/FloatingWindow.tsx`, `ui/TaskDetailWindow.tsx`,
  `ui/CreateTaskWindow.tsx`, `ui/ScheduleTable.tsx`, `ui/TimeField.tsx`,
  `ui/usePlannerDnd.ts`.
- Edited: `ui/TasksRoute.tsx` (view switch), `ui/manualCreation.ts` (per
  view), `rpc/tasksRpcClient.ts` and `rpc/tasksRpcGroup.ts` (new methods),
  `environmentApi.ts` (schedule probe), `package.json` (dnd-kit).

Tests: ported logic tests (calendar layout and lanes, time snapping,
progress per week, optimistic apply functions); store tests (change events
refetch exactly the affected windows, tasks and progress; sync refetches
all; version guard and tombstones against stale reads; failure rollback);
pure DnD planning (drop target to placement, calendar Y to time). No static
markup tests. One integrated pass in a real client after phase 2, on
request, using a dev database seeded with `vp run migrate-dev-db`.

### Phase 3: agents in the planner

- `TaskToolDefinitions.ts`, `TaskToolService.ts`: `task_schedule_*` tools,
  `task_search` audience default, promptGuidance line.
- `planner/ui`: Mine / Agents / All filter; agent tasks show run counts
  (existing `RunCountNumbers`) and the latest run status; a "Hand to agents"
  action (sets audience) and tag editing in the detail window.
- Tests: tool tests for each schedule tool, read-only mode denial, task-agent
  run writes allowed, `task_search` default.

### Phase 4: routines and reminders

- Routines: `kind: "routine"` creation and a Tasks / Routines switch in the
  toolbar (open question 13); weekly progress; default routine duration.
- Reminders: migration 022 (`remind_at`, `reminder_sent_at`, partial index);
  `scheduleTimeZone` and lead-minute settings; a sweeper in tasks-server that
  claims due entries in a transaction (port of `claimDueReminders` without
  web push) and publishes them; desktop shows a system notification through
  the existing notification path (`apps/web/src/threadNotifications.ts`,
  `ThreadNotificationCoordinator.tsx`); clicking opens the task window.
- Tests: reminder computation (port of wande's), claim idempotency across
  restarts, recompute on time or setting change, no reminder for done or
  past entries.

### Phase 5: optional Convex import

- An import service in tasks-server reading a `npx convex export` archive:
  projects matched by title to existing projects, otherwise Inbox; tasks and
  routines as person tasks with the status mapping in 3.5 and rank from
  `order`; `queueInstances` rows (not the embedded arrays) as entries with
  position from `order` and status `new -> open`, `done -> done`,
  `archived -> skipped`. Idempotent through `metadata.wandeId`. Exposed as a
  CLI command and a tool, never automatic.
- Tests: fixture export round trip, rerun is a no-op, orphaned instances
  (wande's deleted tasks) are skipped and counted.

## 11. Open questions and recommendations

1. **Can a trigger tag hand a person task to an agent?** Recommendation: yes,
   only agents that require at least one tag, and only when all their tags
   are present (4.1). The alternative, requiring an audience flip first, is
   safer but makes "add the dev tag" silently do nothing, which surprises.
2. **`task_search` default audience for tools.** Recommendation: `agent`.
   Agents find their queues with tags today, so this is defense in depth: an
   agent instruction like "take the next To Do task" never picks a person
   task. RPC keeps `all` for existing clients.
3. **Does flipping a task back to `person` stop active runs?**
   Recommendation: no, consistent with status and tag changes; the person
   stops a run explicitly. Revisit if users expect "take it back" to stop.
4. **Should finishing the last entry complete the task, or completing the
   task close open entries?** Recommendation: no, keep wande's
   independence (5.3); render the joined task state on entries.
5. **Planner across environments.** Recommendation: one environment at a
   time, primary by default (8.1). A merged multi-environment day has no
   defined order.
6. **Project changes on tasks.** Recommendation: add `projectId` to
   `TaskUpdateInput` and treat it as a trigger change. Without it the
   project chip, a core wande control, cannot work.
7. **Inbox location and identity.** Recommendation: `<T3 home>/tasks-inbox`,
   a visible normal project titled Inbox, id stored in a tasks setting,
   recreated on demand.
8. **Time zone for reminders.** Recommendation: one server setting
   `scheduleTimeZone` defaulting to the server's zone, introduced in phase 4.
   Dates and times stay wall-clock until then.
9. **Bulk operations.** Recommendation: server `reorderMany` now (order must
   be atomic); client loops for bulk update and delete; add `updateMany`
   only if loops prove slow.
10. **Description editor.** Recommendation: textarea plus `ChatMarkdown`
    preview, no Milkdown. A tiptap editor can come later with markdown
    round-trip tests.
11. **Where planner preferences live.** Recommendation: local storage in
    phase 2; move the synced ones to the server only if multi-device use
    asks for it.
12. **Wande's Projects tab and project creation from the planner.**
    Recommendation: drop both. Projects are created and arranged in the
    sidebar; the planner shows them and Inbox.
13. **Routines entry point.** Decided: a Tasks / Routines toggle in the
    planner toolbar, left of Mine / Agents / All (wande had a separate tab),
    phase 4. The two switches are the list's two axes, what and whose.
14. **Calendar drop ordering.** Recommendation: insert by time (5.2) rather
    than wande's full re-sort of the day, which reorders hand-arranged
    untimed entries.
15. **Reminder delivery with several clients.** Recommendation: the server
    claims each reminder once; only the desktop shell raises a system
    notification, web clients show an in-app toast. Decide in phase 4.
16. **This document's place in the repo.** Root `AGENTS.md` says not to
    commit implementation plans; the task asked for this one. Recommendation:
    once phase 4 lands, fold the durable parts (audience rule, schedule
    semantics) into `docs/tasks/README.md` and delete this file.
17. **Brief vs code discrepancies found.** `apps/web` already uses dnd-kit;
    `docs/tasks/*` is missing on `next/v2`; `TaskUpdateInput` lacks
    `projectId`; tasks-server cannot create projects. Recommendation: treat
    them as described in this document; bring `docs/tasks/` over from `main`
    when the branch merges.
