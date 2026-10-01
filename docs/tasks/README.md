# Tasks, agents, and automations

Local task orchestration ships in the public build. Tasks are durable work
items; task agents are saved agent definitions that start a provider thread on
a task when it matches their trigger; automations create tasks on a schedule.
Everything runs on your machine and is stored in the server's SQLite database.

The packages:

- `@upcomputer/tasks-contracts`: schemas and RPC groups.
- `@upcomputer/tasks-server`: storage, the agent scheduler, automations, the
  `upcomputer_tasks` dynamic tools, and a loopback-only MCP endpoint at
  `/api/extensions/upcomputer.tasks/mcp`.
- `@upcomputer/tasks-web`: the Tasks, Agents, and Automations views and the
  Instructions settings page.
- `@upcomputer/orchestrator` and `@upcomputer/orchestrator-web`: the
  read-only Orchestrator mode and its structured proposals.

The public product entries (`apps/server/src/product/publicProductEntry.ts`
and `apps/web/src/product/defaultProductEntry.ts`) compose them through the
extension API.

## Tasks

A task has a title, description, free-form status, tags, an optional
`notBefore` time, an output (the latest concise result), events, and an
optional assignee run. Statuses are plain strings; a common workflow is
`Backlog` → `To Do` → `In Progress` → `Needs Review` → `Done`. Tasks are kept
in one global order per environment.

## Agents and trigger rules

An agent has instructions, a model selection, a runtime mode, an optional
project, and a trigger: `startStatuses`, `startTags`, and optionally
`startRunStatuses`. The scheduler applies these rules (`TASK_TRIGGER_RULES` in
`packages/tasks-server/src/tools/TaskToolDefinitions.ts`; agents receive the
same list from `task_context`):

1. An enabled agent starts on an open task when the task's status is in its
   `startStatuses` (empty means any), the task has all of its `startTags`, and
   the task's `notBefore`, if set, has passed.
2. Setting a matching status or adding a matching tag starts the agent
   immediately. Park work in a status no agent starts on (for example
   `Backlog`), or set `notBefore` to delay it.
3. An agent runs again on the same task only after the task's title,
   description, status, tags, `notBefore`, or `closedAt` really changed after
   its previous run there ended, or after the agent itself was edited. Output,
   assignment, metadata, and priority changes never restart agents. To retry,
   change the status or set `notBefore` (now or later).
4. Several agents may run on one task at once. Such an agent should finish by
   removing its own trigger tag or moving the status; otherwise a later change
   starts it again.

### Run lifecycle

A run starts a new provider thread with the agent's instructions, the
execution guidance from Settings → Instructions, the task, and the run's
identity. A started run keeps running while the task's status and tags change.
It ends when it reports its `task_agent_result`, sets `assigneeAgentRunId`
away from itself, is stopped with `agent_run_stop`, when the task is closed or
deleted, or when the agent is disabled or deleted.

Run statuses:

- `completed`: the agent reported a result, or released its assignment.
- `blocked`: the agent itself reported it cannot continue.
- `failed`: the server saw the run break (provider error, missing thread, no
  result).
- `interrupted`: the app restarted during the run.
- `stopped`: `agent_run_stop`, a person stopped the session or interrupted the
  turn, the task was closed or deleted, or the agent was disabled or deleted.

### Run-status agents

An agent with `startRunStatuses` (`failed`, `interrupted`, `blocked`) does not
start on task state alone. It starts once for each run of another agent on a
matching task that ended with one of those statuses and is still that agent's
latest run there. Runs started this way never trigger such agents, and stopped
runs never trigger agents. Use it for an agent that decides what happens after
a failure; its prompt names the triggering run.

### Result protocol

Every run ends its final message with a fenced block:

```text
~~~task_agent_result
{"status":"Needs Review","summary":"What changed and how it was verified.","blocked":false,"events":[]}
~~~
```

- `summary` becomes the task output and is recorded as a `task.agent-result`
  event.
- `status`, when present, becomes the task status. Leave it out to keep the
  status unchanged.
- `blocked: true` ends the run as `blocked` and, unless `status` is given,
  sets the task status to `blocked`.
- `events` entries (`{"kind": "...", "message": "..."}`) are appended to the
  task.

The run's assignment is released when the result is recorded.

## Automations

An automation creates a task from a template (title, description, status,
priority, tags) on a cron schedule in a time zone. `catchUpPolicy` decides
what happens to slots missed while the app was closed: `skip` drops them and
`fire-once` creates one task. With `skipIfOpen`, a slot is skipped while a
task the automation created is still open. Agents can only create and edit
drafts (`automation_create`); a person activates an automation in the
Automations view.

## Example agents

Two agents that hand work to each other through statuses and a tag. Create
them in the Agents view or with `agent_create`.

**Developer**

- Start statuses: `To Do`. Start tags: `dev`.
- Instructions:

  ```text
  Work only on the assigned task. Claim it, set status "In Progress", and
  implement the description in the task's project. Run the relevant tests.
  Keep the task output current: what changed, verification, open risks.
  Finish with a task_agent_result whose status is "Needs Review". If you
  cannot continue, report "blocked": true with the reason in the summary.
  ```

**Reviewer**

- Start statuses: `Needs Review`. Start tags: `dev`.
- Instructions:

  ```text
  Review the change described in the task output against the description.
  Do not edit code. Append findings with task_event_append. Finish with a
  task_agent_result: status "Done" if it is ready, or status "To Do" with
  the required fixes in the summary to send it back to the developer.
  ```

Workflow: create a task in `Backlog` with tag `dev`, then move it to `To Do`.
The developer runs and ends with `Needs Review`, which starts the reviewer.
Sending the task back to `To Do` is a real status change, so the developer
runs again. To add a failure handler, create a third agent with tag `dev` and
start run statuses `failed` and `blocked`.

See also [task origins and sidebar run counts](./task-origins.md).
