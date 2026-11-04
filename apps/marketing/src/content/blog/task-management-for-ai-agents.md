---
title: Why task management should be the agents' job
description: Agents are good at the bookkeeping a task board needs. Let a chat create the tasks and let agents pick them up, hand them off and review each other, while you decide what to build.
date: 2026-11-04
draft: false
---

Task management should be the agents' job because agents already produce everything a task board needs, and they don't skip the bookkeeping. When a chat creates the tasks and worker agents pick them up, update their status, hand them off and review each other's work, the board stays accurate without you touching it. You spend your time deciding what to build. A board built for people assumes a person moves the cards. A board built for agents assumes the agents do, and you read it whenever you want. That's how the task system in Up.computer works.

## The extra work of a board built for people

Boards made for teams of people work well for teams of people. Once most of the work is done by agents, though, the person in the middle ends up doing clerical work: writing tickets, assigning them, moving cards, copying results from a chat back into the ticket, checking which agent is still running.

Plenty of people already skip the first part and create tickets from a chat instead of by hand. The next step is to let agents work those tickets too, and keep the board up to date as they go.

## What it looks like when agents run the board

Here is a typical flow in Up.computer with two agents, a developer and a reviewer:

1. **You describe a change in a chat.** The chat asks what it needs to know.
2. **The chat creates a task.** The description is self-contained: goal, context, constraints, how to verify, what to report. If it's not clear which agent should take it, the chat shows you the options, recommends one and lets you choose.
3. **The developer agent starts.** Its trigger is a tag plus a status such as `To Do`. It claims the task, sets it to `In Progress`, does the work and keeps the task output current.
4. **It hands off.** When it's done, it moves the task to `Needs Review`. That status change is the hand-off: it starts the reviewer.
5. **The reviewer checks the work.** In the default template, it runs the checks itself, doesn't edit anything, reports findings with file and line, and hands the task to a person.
6. **The next task starts.** Before finishing, the developer moves the next task in its queue from `Backlog` to `To Do`, so work keeps flowing one task at a time.

You did two things in that flow: described the change and read the result.

## Why agents are good at this

**Writing a clear task is a writing job.** A good description has a goal, context, constraints and a way to check the result. Agents write that every time, at 2 a.m. as well as at 10 a.m. Because the description is self-contained, the agent doing the work never needs your chat.

**A status is only useful if it's current.** Agents update the task as they work, and every run has to end with a result that the app records on the task. If an agent can't continue, it says so and the task is marked `blocked` with the reason. If a run breaks without reporting, the app marks it `failed`. Nothing just goes quiet.

**Hand-offs are status changes.** An agent starts when a task matches its trigger: a set of statuses and tags. Moving a task to the next status is all it takes to pass it on. You can also have an agent that starts only when another agent's run fails or gets blocked, and decides what happens next.

**Agents read the board too.** Ask "what's the status?" in any chat and it looks at the tasks instead of guessing. Each task also remembers where it came from: the chat that created it, and the task and run it came out of. The chat itself shows a small badge with its tasks' runs, and a click lists those tasks.

## What you still do

Handing the bookkeeping to agents doesn't mean handing over control.

- **You decide what gets built and in what order.** The task list has one order, and you can drag tasks around in it.
- **You set the rules, in plain words.** "Ask me before picking an agent." "Reviews always go to GPT." The chat saves rules like these in shared instructions that every chat and agent run reads. Every change is kept in a history and can be reverted. Unattended agent runs can't edit these instructions unless you allow it for that agent.
- **You approve.** In the default setup, review ends with a person.
- **You turn on anything recurring.** Automations create tasks on a schedule, for example a weekly dependency check. When an agent creates an automation, it stays a draft until you enable it.

## The design choices behind it

A few decisions make this work:

- **Statuses and tags are plain text.** There's no fixed workflow. `To Do` and `Needs Review` are a convention, not a rule, and you can describe a different one in a chat.
- **Triggers are simple.** An agent starts when a task has the right status and tags. There are no workflow diagrams to maintain.
- **Each agent has its own instructions, CLI and model.** Use a strong model for development, a different one for review, and a cheap, fast one for bulk work. Agents can run on Codex, Claude Code, Cursor, Grok Build or OpenCode.
- **It's local and open source.** Tasks are stored on your computer, and agents run on your own CLI accounts and subscriptions.

## How to try it

[Download Up.computer](/download), sign in to at least one agent CLI and open a chat. Use Claude Code or Codex for that chat: those two can create and read tasks today, while worker agents can run on any supported CLI. Describe a piece of work. After your first request, the chat offers to agree on a process with you, creates the agents you want, and writes the process into the shared instructions. From then on, you talk and the agents keep the board.
