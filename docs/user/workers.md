# Workers

A worker is a saved agent setup that does tasks in the background: a name, an agent and model,
instructions, and triggers that say which tasks it starts on. One worker can write code, another
review it, a third keep the docs current.

Open **Workers** from the button at the bottom of the sidebar, next to Settings. Click a worker to
see and edit its setup, its tasks and its runs.

## Create a worker

Ask in any chat: "Create a worker that reviews my pull requests", or simply ask for a task and let
the chat suggest one. The agent picks a name, model, permissions and triggers, and writes the
instructions. There is no form to create a worker by hand.

How chats set up workers follows **Settings → Instructions → Worker creation**.

To remove a worker, ask a chat to delete it. To stop it for a while, click **Pause** on its row, or
turn off **Enabled** in its details, and **Resume** it later.

A worker you no longer use but want to look back at can be archived: click **Archive** in its
details. It never starts, chats stop offering it, and it moves to the collapsed **Archived** group
at the end of the list, with its runs and tasks kept. **Unarchive** brings it back paused or on, as
it was.

## What a worker has

- **Instructions**: what it does and how. Edit them in the worker's details.
- **Project**: one project, or **All projects**. A worker set to a project only starts on that
  project's tasks.
- **Model** and **Model options**: the agent and model each run uses.
- **Interaction**: **Default**, or **Plan** to have it plan before acting.
- **Runtime**: **Supervised** (asks before acting), **Auto-accept edits** or **Full access**. See
  [Permission modes](./permission-modes.md).
- **Triggers**: **Statuses**, **Required tags** and **After runs**. See below.

## When a worker starts

A worker starts on a task right away when all of these are true:

- The worker is enabled, and its project matches the task's (or it works in all projects).
- The task has one of the worker's **Statuses**, or the worker has none ("Any status").
- The task has every one of the worker's **Required tags**, or the worker has none ("Any tag").
- The task is for workers, not for you. A task for **Me** only starts a worker when it has all
  that worker's required tags.
- The task is not archived, and its **Not before** time, if set, has passed.

**After runs** starts the worker when another worker's run on the task ends as failed,
interrupted or blocked. Use it for a fallback or fixer worker.

A worker starts again on the same task only after the task changes, for example its status or
tags, or after you edit the worker. If no worker matches a task, its **History** says so and the
task waits.

### One task at a time

Up.computer starts every worker whose triggers match, so a worker could run on several tasks at
once. By default, chats and workers keep each worker to one task at a time:

- A chat creates the first task in the worker's start status and the rest in **Backlog**.
- When a worker finishes a task, it moves the bottom **Backlog** task with its tag to its start
  status, so the next one starts.

This is set by **Task creation** and the worker's own instructions, which you can change. Ask for
"fan-out" when you do want several tasks running at once.

## Runs

Each time a worker starts on a task, it starts a run: a new chat of its own, named after the worker
and the task. Runs don't appear in the sidebar's thread list. To open one:

- In the task's details, under **Active runs** or **Runs**.
- In the worker's details, under **Threads**.
- From the chat that created the task: click the run counts in its header or sidebar row.

A run shows its state, such as **Working**, **Approval** (it waits for your permission),
**Awaiting Input** (blocked), **Completed**, **Failed** or **Stopped**.

## When a run ends

By default a worker ends by writing a summary in the task's **Output** and setting the status to
**Needs Review**. Read the output, check the work, and set the task to **Done**, or tell the worker
what to change.

If a worker can't continue, it sets **Blocked** and writes what it needs in the output. The chat
that created the task always wakes up and tells you.

## Message a run

Open the run and type in it, like any chat.

- While the run is working, your message joins it as the next turn.
- After the run has ended, your message continues it as a new run in the same chat. The worker
  keeps what it already knows, so this is the best way to answer a blocked worker or ask for a
  change after review.

From another chat, you can also ask the agent to send a message into a run.

## Stop a run

Stop it in its chat, like any agent turn. You can also archive the task, pause the worker, or ask
a chat to stop the run.
