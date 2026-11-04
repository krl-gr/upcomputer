---
title: "A short history of AI tools, and which one to use for what"
description: From the first ChatGPT chat to agents that work while you're away. Each new kind of AI tool appeared to fix a limit of the one before, and knowing those limits tells you which tool fits which job.
date: 2026-11-04
draft: false
headings: run-in
---

Every kind of AI tool you can use today appeared to fix a limit of the one before it. Chats couldn't see the news, so they got web search. They couldn't see your calendar, so they got integrations. They couldn't touch your files, so we got CLIs and then desktop apps.

Here is that story.

## It started with a chat.

In November 2022 the world saw ChatGPT. The interface was very simple: you start a chat as if with a person and ask questions.

AI was still weak then. It could only keep a few thousand tokens of the conversation in mind, about a few pages of text, and its answers got worse as a discussion grew longer. That's partly why you had to start new chats instead of keeping one long conversation.

## The model doesn't know what happened today.

The first big problem: a model's knowledge is frozen at the moment it was trained. It doesn't know new facts. If you asked it what happened today, it would make up an answer. This is called hallucination.

To fix this, models were given a tool: web search. Now when you ask what happened today, the model can search the internet for you and answer with what it found.

## It can't see your calendar.

Not everything is on the open web. To tell you what's in your calendar, the AI needs access to it. That's how integrations with other services appeared: calendar, email, documents, task trackers. AI got access not only to read this information but also to change it: create an event, reply to an email, edit a document.

In late 2024 Anthropic released MCP, an open standard for connecting AI to any service. Since then, most tools support the same integrations, and adding a new one became much easier.

## It can't touch your files.

However many integrations you add, it may not be enough. Part of your information and files isn't in online services. It's on your computer. A web page in a browser can't reach them. You need an app installed on your computer that can read your files and change them.

Developers already had something like this inside code editors: GitHub Copilot since 2021 and Cursor since 2023. For everyone else, the first such tools were CLIs.

## CLIs: an app without a face.

CLI stands for command-line interface. It's an app with no graphical interface: no buttons, menus or input fields. It runs in the terminal on your computer, and you control it with text.

The CLI that made this mainstream was Claude Code, released in early 2025. OpenAI followed with Codex CLI.

A CLI can do far more than a chat:

- read, create, edit and delete files on your computer;
- write code and run it;
- use your computer like a person: a second cursor appears, opens apps, clicks buttons, scrolls, does something in a browser, etc.

But for people who don't know the terminal, it's hard to use. The interface is hard to read, and moving between conversations is clumsy. A CLI was simply the easiest thing to build, so it came first.

## Desktop apps: the same power, with a normal interface.

The logical next step was a familiar app with a normal interface. That's how the Codex app and Claude Code app appeared.

Each of these apps has the familiar chat, but also a new mode. In that mode, a very different program runs underneath, one that lets the model run commands on your computer. In practice it's a CLI plus a graphical interface.

## Independent apps.

Imagine you've worked in Codex for a month. All your context is there: chats, decisions, project history. Then you realize Claude handles your tasks better. To switch, you have to leave all of that in Codex and start again from zero in Claude.

That's why another kind of desktop app appeared at the same time: apps from independent developers that work on top of the providers' CLIs. They run the official Claude Code, Codex and other CLIs you already have, signed in with your own accounts, all in one window.

With them, switching providers becomes as easy as switching models. You can even use several at once: one plans, another writes, a third reviews. And your chats stay on your computer, not on one company's server.

## From delegating tasks to delegating a process.

Every tool so far has one thing in common: you sit in a conversation and wait for the answer. But modern AI models can do much more than that. They can start threads on their own, and they have memory, so they remember things. So instead of threads, we can now create bots: chats with long-lived memory. That's the idea behind ChatGPT Dots, Grok Bot and Claude Duet, and behind independent bots like Hermes Agent and OpenClaw.

## Which tool to use for what.

To answer this question, you need to know one more thing: AI works better when it has better memory. If you use Codex or Claude Code, that works until you realize that a new model from a different provider is better or cheaper for your tasks. That's why it's always better to control your data and keep it on your computer.

If all you need from AI today is a quick question, a provider's web chat or mobile app is fine. If you need advanced work, like constantly handling your calendar, your writing, content creation or code, it's better to use an independent app on top of the CLIs.

That's why we created Up.computer. It has bots, regular threads and a task management system, works with any provider, and it's free.

If you're wondering what to pay for, subscription or API, provider or reseller, we wrote about that separately: [Subscription, API or reseller: which AI tools are worth paying for](/blog/subscription-api-or-reseller/).
