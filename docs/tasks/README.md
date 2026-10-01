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

The public product entries (`apps/server/src/product/publicProductEntry.ts`
and `apps/web/src/product/defaultProductEntry.ts`) compose them through the
extension API.

Any chat orchestrates work through the task tools. The former Orchestrator
mode and its proposal pipeline are removed. Threads that stored the
`orchestrator` mode open and continue as Default. Their old proposals stay in
the `upcomputer_orchestrator_proposals` table, which nothing reads or drops.
Tasks applied from a proposal keep their `orchestrationProposal` metadata,
which the Tasks view and task agents still read.

## Tasks

A task has a title, description, free-form status, tags, an optional
`notBefore` time, an output (the latest concise result), events, and an
optional assignee run. Statuses are plain strings; a common workflow is
`Backlog` → `To Do` → `In Progress` → `Needs Review` → `Done`. Tasks are kept
in one global order per environment.

The server also keeps `triggerChangedAt`: the time of the last real change to
the title, description, status, tags, `notBefore`, or `closedAt`. Writes that
leave those fields as they were, and changes to the output, assignee,
metadata, or priority, do not move it.

## Agents and trigger rules

An agent has instructions, a model selection, a runtime mode, an optional
project (an agent with a project starts only on that project's tasks), and a
trigger: `startStatuses`, `startTags`, and optionally
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

Rule 3 compares times: an agent runs again when the task's
`triggerChangedAt` is later than the end of its previous run on the task, or
the agent's `updatedAt` is later than that run's start. A status set by a
run's own `task_agent_result` is recorded at the run's end, so it does not
start the same agent again; it can start other agents. Each agent has at most
one active run per task.

`notBefore` holds back every start on the task until it passes. The server
checks for tasks whose `notBefore` passed every few seconds and on startup, so
a postponed task starts without another change. `agent_run_message` ignores
`notBefore`.

### Run lifecycle

A triggered run starts a new provider thread with the agent's instructions, the
execution guidance from Settings → Instructions, the task, and the run's
identity. A started run keeps running while the task's status and tags change.
It ends when it reports its `task_agent_result`, sets `assigneeAgentRunId`
away from itself (a release), is stopped with `agent_run_stop`, when the task
is closed or deleted, or when the agent is disabled or deleted. Ending a run
clears the task's `assigneeAgentRunId` if it still names that run.

`agent_run_stop({ id })` stops an active run as `stopped` and stops its
provider session; for an ended run it changes nothing. A stopped run is that
agent's latest run on the task, so the agent starts there again only after a
real change (rule 3).

Run statuses:

- `completed`: the agent reported a result, or released its assignment.
- `blocked`: the agent itself reported it cannot continue.
- `failed`: the server saw the run break (provider error, missing thread, no
  result).
- `interrupted`: the app restarted while the run was working. All such runs
  end at once after a restart, so run-status agents start for each of them.
- `stopped`: `agent_run_stop`, a person stopped the session or interrupted the
  turn, the task was closed or deleted, or the agent was disabled or deleted.

### Messaging runs

`agent_run_message({ runId, text })` sends a message to any run's thread. It
is an explicit start: triggers, the re-run rule, and `notBefore` do not apply.

- An active run receives `text` as its next turn, exactly like a person's
  message in that thread: the provider queues or steers it while a turn is
  running. The run record does not change.
- An ended run of any status continues in its own thread, with its context,
  as a new run whose `continuesRunId` is the messaged run. The messaged run
  keeps its status. The turn starts with a short header that gives the new
  `agentRunId`, followed by `text`. The continuation then ends like any run:
  its own `task_agent_result`, a release, `agent_run_stop`, closing or deleting
  the task, disabling or deleting the agent, or a failure.
- A continuation has no `triggerRunId`. If it fails, it is its agent's latest
  run on the task, so run-status agents start for it as usual.

The message is refused while the task is closed, the agent is disabled or
deleted, the run's thread is gone, or the run is finishing. Each agent still
has at most one active run per task: messaging an ended run while the agent
has another active run there returns that run's ID to message instead.
Nothing retries on its own; after a usage limit, an agent or a person
messages the run once the limit resets.

### Run-status agents

An agent with `startRunStatuses` (`failed`, `interrupted`, `blocked`) does not
start on task state alone. It starts once for each run of another agent on a
matching task that ended with one of those statuses after the run-status agent
was created and is still that agent's latest run there. The task must still
match the agent's statuses, tags, project, and `notBefore`. Runs started this
way never trigger such agents, and stopped runs never trigger agents. Use it
for an agent that decides what happens after a failure; its prompt names the
triggering run.

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
  sets the task status to `blocked`. A `status` containing "block" also
  counts as blocked.
- `events` entries (`{"kind": "...", "message": "..."}`) are appended to the
  task.

The run's assignment is released when the result is recorded.

## Instructions

Settings → Instructions holds five shared texts: `allChats` (the All chats
tab), which is the core `customInstructions` setting and part of the prompt of
every chat and every run in every harness; `taskCreation`, `agentCreation`,
and `automationCreation`, which `task_context` returns as `promptGuidance`;
and `taskExecution`, which is part of every run's prompt. Besides the settings
page, chats read and edit them with tools:

- `instructions_get` returns the texts, their lengths, and a `revision` that
  changes on every edit.
- `instructions_update({ field, text, reason, expectedRevision })` replaces
  one field. It is refused when `expectedRevision` is not current, so two
  chats cannot overwrite each other.
- `instructions_history({ field?, limit? })` lists changes newest first, with
  the previous and new text, the reason, and the source: the settings page,
  or the thread and run that made it.
- `instructions_revert({ changeId, reason? })` restores the text from before
  a change and records that as a new change. It is refused when the field
  changed after that change; revert the later changes first.

`allChats` is stored only in core settings (trimmed, at most 20,000
characters); its history and the shared revision live with the task fields.
The shipped defaults describe the delegation workflow: chats turn work into
tasks for background agents, each agent works through its queue one task at a
time, and its hand-off starts the next one. All chats starts with a one-time
onboarding block that the first chat with the user removes once the process
is agreed (see `docs/architecture/providers.md` for when the All chats default
applies). Upgrading replaces a task field's text only while it still equals an
earlier shipped default, and records that as a change with source `unknown`.
Every change, including settings-page saves, is recorded; history is never
deleted. An edit of `customInstructions` outside the Instructions page, such
as a hand edit of `settings.json`, is not recorded, and a later revert of an
earlier change is then refused because the text changed since. The write
tools dry-run in read-only interaction modes. Task-agent runs may only read: a
run's agent must list `instructions_update` or `instructions_revert` in its
tools to write. A thread stays a run thread after its run ends; the latest run
on it decides, and history records that run. Ordinary chats and the loopback
MCP endpoint may write. This guards against accidental or injected writes by
unattended agents. It is not a security boundary: a run with shell access can
edit the settings files directly.

## Automations

An automation creates a task from a template (title, description, status,
priority, tags) on a cron schedule in a time zone. The scheduler checks every
30 seconds. `catchUpPolicy` decides what happens to slots missed by more than
two minutes, for example while the app was closed: `skip` drops them and
`fire-once` (the default) creates one task. With `skipIfOpen`, a slot is
skipped while a task the automation created is still open. Created tasks
start agents like any other task. After five failures in a row, or when its
schedule no longer parses, an automation turns itself off.

Agents can only propose drafts (`automation_create`, at most 20 per project)
and edit or delete drafts; a person enables an automation in the Automations
view.

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
