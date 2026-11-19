# Tasks and the planner

A task is a piece of work with a title, a description, a status and tags. Workers do tasks for
you in the background. You can also keep your own tasks and plan your days in the planner.

Open **Tasks** in the sidebar. The page has two sides, switched with the Me / Workers buttons at
the top:

- **Me** is the planner: your own tasks and routines, and your days.
- **Workers** is a table of the tasks for workers, and their automations.

The **Tasks** panel on the right of a chat (shortcut `K`) shows the same tasks next to your work.

## Create a task

The easiest way is to ask in any chat: "Create a task to update the changelog", or "Make three
tasks for these bugs". The agent writes a self-contained description, picks the project and adds
the tags of the worker that should do it. See [Getting started](./getting-started.md#turn-a-chat-into-a-task).

To create one by hand:

- On the **Workers** side, click **+** and fill in the title, project, status and tags.
- On the **Me** side, click **+** above the list, or right-click a task and choose **Create task
  above** or **Create task below**.

## Statuses

A status is plain text. Up.computer does not force a fixed set, and the status menu in a task's
details offers the statuses your tasks already use. By default, agents use these:

| Status       | Meaning                                                       |
| ------------ | ------------------------------------------------------------- |
| Backlog      | Waiting its turn. Workers usually don't start on it.          |
| To Do        | Ready. A worker that starts on To Do picks it up.             |
| In Progress  | A worker is on it.                                            |
| Needs Review | The worker is done. Check the output and the work.            |
| Blocked      | The worker needs you. The chat that created the task is told. |
| Done         | Finished.                                                     |

What a status means for workers depends on their triggers. A worker starts on a task when the task
has one of the worker's start statuses and all its required tags. See
[When a worker starts](./workers.md#when-a-worker-starts).

**Blocked** is special: a worker that sets it ends its run as blocked, and the chat that created
the task always wakes up to tell you, even when **Wake chat when tasks complete** is off.

## Tags and projects

Tags group tasks and decide which worker picks them up. A worker's required tags work like an
address: a task with the tag `docs` goes to the worker that requires `docs`. Use the tag filter on
the Workers side to see one worker's queue.

Each task can belong to a project. A worker set to one project only starts on that project's
tasks. Your own tasks without a project go to an **Inbox** project that Up.computer creates for
you the first time it needs it.

## Your tasks and workers' tasks

Every task is either for you or for workers. The **For** field in a task's details shows which:
**Me** or **Workers**.

- Tasks for **Me** show in the planner. Their status is either To Do or Done. A worker does not
  start on them, unless the task carries every tag a worker requires.
- Tasks for **Workers** show in the table, and workers start on them by their triggers.

To hand one of your tasks to workers, open it in the planner, open **More actions** and choose
**Hand to a worker…**. Pick a worker, or **No particular worker**. Picking a worker adds its tags
and sets the status it starts on, so it starts right away. To get a task back, choose **Take back
from workers**. Its status returns to To Do. Runs that already started keep running.

## Start a task later

A task can wait until a date and time before workers start on it. There is no field for this in
the task's details: ask the agent when you create the task, for example "start this tomorrow at
9:00". The details then show **Not before**, and no worker starts until then.

## Archive a task

**Archive** hides a task without deleting it. Archiving stops any running work on it, and workers
never start on archived tasks. Use the **Show** filter to see archived tasks, and **Unarchive** to
bring one back. Archiving is separate from the status, so a task keeps its status while archived.

## Order and queues

Drag a task's handle on the Workers side to reorder it. New tasks appear at the top. Workers take
their next task from the bottom, so a lower task runs sooner.

## Plan your days

The **Me** side has two parts: your list of tasks and routines, and your days above it.

- Choose **View** for **Queue** (a list per day) or **Calendar** (a timeline), and **Days shown**
  for 1, 2, 3 or 7 days.
- To plan a task for a day, click the day's heading and use **Add to queue** on the task, or use
  **Schedule** to give it a date, a time and a duration. A task can be planned on several days, or several times a day.
- Each planned entry has its own state: right-click it for **Done**, **Skipped**, **Move to next
  day**, **Copy to next day** or **Set time & duration**. Marking an entry done does not finish
  the task.

**Routines** are your habits and chores, in their own tab next to Tasks. Plan them like tasks.
Up.computer does not repeat them by itself: use **Copy to next day** to plan the next one. For work
that should happen on a schedule without you, use [automations](./automations.md).

### Reminders

Planned entries with a time remind you before they start, as a notification. Turn reminders on or
off, choose how many minutes before, and set the schedule's time zone under **View options** in
the planner. Reminders are on by default, 10 minutes before.

## Change how agents handle tasks

**Settings → Instructions** holds the text that tells agents how to work with tasks:

- **Task creation**: how a chat writes tasks and chooses a worker.
- **Worker creation**: how a chat sets up new workers.
- **Automation creation**: how a chat sets up automations.
- **Task execution**: how workers behave on a task.
- **All chats**: text added to every chat.

Edit them to match how you work. Choose a project in the settings scope to add text for that
project only.
