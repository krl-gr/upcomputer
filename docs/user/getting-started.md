# Getting started

This guide takes you from a fresh install to your first task done by a worker in the
background. It takes a few minutes.

## Install

Download the desktop app from [up.computer/download](https://up.computer/download/). There are
builds for macOS, Windows and Linux. See [Install Up.computer](./install.md) for the command line
and other options.

## Your first agent

You don't need a subscription to start. On first launch the desktop app opens straight into a
chat and sets up an agent for you:

- If Claude Code or Codex is already installed and signed in on your computer, the app uses it.
- Otherwise it downloads OpenCode by itself and uses a free OpenCode Zen model, with no account.

While this runs, the composer shows **Setting up your agent…**. If it fails, select **Retry**, or
**Connect another agent** to set up a different one. See
[First launch](./welcome-wizard.md#first-launch-of-the-desktop-app) for details.

To use your own subscription, sign in to its agent and turn it on in **Settings → Providers**:

- Claude Code: install [Claude Code](https://claude.com/product/claude-code) and run
  `claude auth login`.
- Codex: connect with ChatGPT in **Settings → Providers**, or install the Codex CLI and run
  `codex login`.

Other agents are listed in the [provider setup table](./install.md#providers).

## Your first chat

Type a message in the composer and send it. A chat (a thread) can work in one of your projects,
a folder on your computer, or without a project in its own scratch folder. Pick the project in the
new thread's heading. See [Working with threads](./thread-sidebar.md#start-a-thread).

Pick the agent and model for each chat from the composer. You can run several chats at once.

## Turn a chat into a task

When you want something done in the background, ask for it in the chat. For example: "Make this
a task for a worker" or "Create a task to fix the login bug".

The agent writes the task: a title, a description it can work from without your chat, and the tags
of the worker that should do it. By default it first shows you the workers that fit, recommends
one, and waits for your choice. If no worker fits, it suggests creating one. Say yes, and it
creates the worker for you. You never have to fill in a form.

What the agent does here follows **Settings → Instructions**, which you can edit. See
[Instructions](./tasks.md#change-how-agents-handle-tasks).

## A worker picks it up

A worker starts as soon as a task has the status and tags it waits for. It works in its own
background chat, so your chat stays free.

- The chat's sidebar row and header show run counts while its tasks run. Click them to see the
  tasks and open a run.
- Open **Tasks** in the sidebar, then **Workers** in the Me / Workers switch, to see every task,
  its status and its runs.
- When the run ends, the chat that created the task replies with the result. To save tokens, turn
  off **Settings → Threads → Wake chat when tasks complete**. Blocked or failed runs still wake the
  chat.

A finished task usually ends in **Needs Review** with a summary in its **Output**. Read it, check
the work, and set the status to **Done**.

## Next steps

- [Tasks and the planner](./tasks.md): statuses, tags, and your own tasks.
- [Workers](./workers.md): how workers start, and how to talk to a run.
- [Bots](./bots.md): a permanent chat with memory.
- [Automations](./automations.md): tasks on a schedule.
