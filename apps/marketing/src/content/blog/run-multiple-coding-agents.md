---
title: How to run several coding agents at once without losing track
description: Track the work, not the chat windows. One chat turns requests into tasks, background agents pick them up, and you ask for the status instead of hunting for it.
date: 2026-11-04
draft: false
---

To run several coding agents at once without losing track, stop tracking agents by their chat windows and track the work instead. Talk to one chat, let it turn each request into a task with a description, a status and a result, and let background agents pick those tasks up. Then "what's running, what's blocked, what's next" becomes a question you ask, not something you keep in your head. Up.computer is a free, open-source desktop app that works this way with the agent CLIs you already use: Codex, Claude Code, Cursor, Grok Build and OpenCode.

## Why several agents get messy so fast

Every agent gets its own thread or terminal tab. After the third one, you are the scheduler. You remember which tab has which job, which one is waiting for your answer, and which one finished an hour ago and still needs a look. The agents work in parallel, but your attention doesn't.

The context lives in chat scrollback, so after a break you reread threads to work out where things stand. More tabs, better tab names or a second monitor don't fix this. Moving the state out of the chats does.

## The setup: one chat, many tasks, background agents

Here is the loop in Up.computer:

1. **Open a chat and say what you want.** Talk it through for as long as you need. The agent asks follow-up questions.
2. **The chat creates a task.** The description is self-contained: goal, context, constraints, how to verify, what to report back. The agent doing the work never needs to read your chat.
3. **A worker agent picks it up.** The task gets a status and tags. The agent whose trigger matches starts on it in the background, in its own thread.
4. **You move on.** Your next idea becomes the next task, in the same chat or a new one.
5. **Ask for the status.** Come back later and ask "what's the status?". The chat reads the tasks and tells you what's done, what's running and what's stuck.

You never wait for a task to finish before starting the next conversation, and you don't have to keep a thread per job open.

## What holds it together

### Tasks hold the context, not threads

A task has a title, a description, a status, tags, an output with the latest result, and a log of events. That's what you and the agents look at. Each agent run gets its own thread, but run threads stay out of the sidebar. You open one from the task when you want the details, and the sidebar stays readable.

### Agents start on triggers you choose

A task agent is a saved setup: a name, instructions, a CLI and model, and a trigger made of statuses and tags. Setting a matching status or adding a matching tag starts the agent right away. To hold work back, park it in a status no agent watches, such as `Backlog`, or give it a start time.

Statuses and tags are plain text, so the workflow is yours. A common one is `Backlog`, `To Do`, `In Progress`, `Needs Review`, `Done`, but nothing forces it.

Because each agent has its own CLI and model, you can give different jobs to different tools. For example, Claude Opus through Claude Code as the developer and a GPT model through Codex as the reviewer.

### A queue instead of a pile-up

The default instructions give each worker a queue. If the worker already has a task, new tasks wait in `Backlog`, and when it finishes one it moves the next one up. You can reorder the task list at any time by dragging.

The queue is a rule in the agents' instructions, not something hard-coded, so you can change it in plain words. Ask for two tasks to run side by side and they will.

One honest caveat: task agents work in the project's own folder, not in separate git worktrees. If two tasks would edit the same files, keep them in one queue so they run one after another.

### "Blocked" is a status, not a surprise

Every run ends with a result that the app records on the task. If an agent can't continue, it says so, the run ends as `blocked`, and the reason is in the task output. A run that breaks without reporting is marked `failed`, so it doesn't just go quiet.

Nothing retries on its own. If a run stops because a CLI hit its usage limit, you or another agent send the run a message once the limit resets, and it continues in its own thread with its context intact.

### You set it up by talking

You don't fill in forms. The chat creates agents and tasks for you, and saves how you like to work in shared instructions that every chat and every agent run reads. When you agree on a new rule in a chat, the chat updates those instructions itself. Every change is kept in a history and can be reverted.

If you want to look under the hood, there are Tasks, Agents and Automations views in the app.

## What you need

- A Mac, Windows or Linux computer. Agents run locally, and tasks are stored on your machine.
- At least one agent CLI you're signed in to. Each one runs on your own account or subscription. Codex and Claude are on by default. Cursor, Grok and OpenCode are turned on in settings, and some of them are still in early access.
- For the chat you orchestrate from, use Claude Code or Codex: those two can create and read tasks today. Worker agents can run on any supported CLI. They report their result at the end of the run, and the app writes it to the task.

## The short version

- Track the work, not the windows.
- Talk to one chat. Tasks are the source of truth. Background agents do the work.
- Ask for the status instead of going looking for it.
