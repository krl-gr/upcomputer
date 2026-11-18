# FAQ

Up.computer is built and maintained by one person: me. These are the questions I get most often.

## What is Up.computer?

A free, open-source desktop app for coding agents. You bring the agents you already use, such as
Claude Code, Codex, Cursor or OpenCode, and run them all from one place. You can chat with an agent
directly, or turn an idea into a task that a worker agent picks up in the background.

Up.computer is a fork of the open-source [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
project. It keeps that project's agent runtime and adds its own product on top: tasks, workers,
bots, automations, computer use and its own look.

## Is Up.computer a harness?

No. A harness is what turns a language model into an agent. It gives the model tools, runs them,
and hands the results back. Claude Code is an interface plus a harness underneath (the Claude Agent
SDK). Codex is the same split: the app plus the Codex App Server.

Up.computer uses those harnesses. It does not replace them, and it does not work without one. Think
of the model as the chef and the harness as the kitchen. Up.computer is the restaurant that lets you
bring whatever kitchen you like.

## Why use it instead of Claude Code or the Codex app?

- **One app for every agent.** Switch between Claude Code, Codex, Cursor, OpenCode and others
  without learning a new tool each time.
- **Work in the background.** Turn a chat into a task. A worker agent picks it up by status and tag
  while you keep talking. Automations and scheduled tasks start work on their own.
- **Your own subscriptions.** Each agent runs on the account you already pay for.
- **Remote access.** Agents run on the computer where Up.computer runs. You can drive them from
  another computer or a browser. See [Remote access](./remote-access.md).
- **Open source.** The code is MIT licensed. If I take it in a direction you do not like, you can
  fork it.

## Is it free?

Yes. The app is free and open source (MIT). There is nothing to buy. You still pay your agent
provider as you do today, if you use a paid plan.

UpComputer Connect, the built-in way to reach your computer from other devices, is free too. Each
account can link up to 3 computers. Phones and browsers that connect to them do not count.

## Do I need a subscription?

No. If no agent is set up on your computer, the desktop app installs OpenCode for you on first
launch. New threads then use a free OpenCode Zen model, with no account needed. If you already use
Claude Code or Codex and are signed in, the app uses that instead and downloads nothing. See
[First launch](./welcome-wizard.md#first-launch-of-the-desktop-app).

## Can I use my Claude or ChatGPT subscription?

Yes. Up.computer runs each agent through its own official CLI or SDK, signed in with your own
account. Sign in to Claude Code with `claude auth login`. For Codex, connect with ChatGPT in
**Settings → Providers**, or run `codex login`. See [Claude](./providers-claude.md) and
[Codex](./providers-codex.md).

## Which agents are supported?

Codex, Claude Code, Cursor, Grok Build, OpenCode, Google Antigravity, Pi, Kiro, Muse Code and fx.
You can also add any agent from the ACP Registry, or a local ACP command, with **Add provider** in
**Settings → Providers**. Codex and Claude are on by default. Turn the others on in
**Settings → Providers**. See [Install](./install.md#providers) and
[ACP providers](./providers-acp.md).

## Can I use an API key or OpenRouter instead?

Yes. Add another provider instance in **Settings → Providers** and give it its own keys and
endpoint. Claude has a full OpenRouter recipe. Your subscription setup stays as it is. See
[OpenRouter](./providers-claude.md#openrouter) and [Provider instances](./install.md#providers).

## Can I use more than one account for a provider?

Yes, a few. Add a second provider instance for a work account, for example. Setup guides:
[Codex](./providers-codex.md#use-multiple-accounts) and
[Claude](./providers-claude.md#separate-accounts-or-configurations). If you use a
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) hub to pool accounts, Up.computer can
show its pooled limits under Usage. See [Connect a hub](./usage.md#connect-a-cliproxyapi-hub).

## Where is my data?

On your computer. Threads, tasks and settings live in the `.upcomputer` folder in your home
directory. Your code and prompts go from your computer straight to your agent's provider, such as
Anthropic or OpenAI. They do not go to me.

UpComputer Connect only sets up the link between your devices. Traffic goes through a Cloudflare
tunnel that runs on your computer. The relay does not carry your sessions.

Up.computer does send basic product usage events, such as which provider and model ran and token
totals. They never include prompts, replies or file contents. To turn them off, set
`T3CODE_TELEMETRY_ENABLED=false` before starting the server. See
[Product usage data](./telemetry.md) for the full list.

## Does it work on Windows, Mac and Linux?

Yes. There are desktop builds for macOS (Apple Silicon and Intel), Windows and Linux. On Windows you
can also run agents inside WSL: choose a distro in **Settings → Sharing & access**. See
[Install](./install.md).

## Windows says "Windows protected your PC". Is that safe?

That is the SmartScreen warning. The Windows installer is not code signed yet, so Windows does not
recognize it. Select **More info**, then **Run anyway**. Download the installer only from
[up.computer/download](https://up.computer/download/) or the
[GitHub releases](https://github.com/krl-gr/upcomputer/releases/latest). The macOS builds are signed
and notarized.

## How do I use Up.computer from another device?

Your agents run wherever Up.computer runs: your desktop, a server or a VPS. You connect to it from
elsewhere. UpComputer Connect is the easy path: sign in on both sides and link the computer. Pairing
over your local network and Tailscale work too. On a server without the desktop app, run
`up remote`. See [Remote access](./remote-access.md).

There is no Up.computer mobile app yet.

## Why does UpComputer Connect keep disconnecting?

Open **Settings → Environments**, find the computer and select **Details**. The first step marked
as failed is the cause. Tailscale is a good fallback if Connect keeps dropping. See
[UpComputer Connect troubleshooting](./t3-connect-troubleshooting.md).

## Worktrees are eating my disk. How do I clean them up?

Open **Settings → Worktrees** and turn on **Automatic worktree cleanup**. You can also run a cleanup
from there right away. See [Storage cleanup](./project-settings.md#storage-cleanup).

## Will my computer sleep in the middle of a long run?

Not with the desktop app. While an agent works, it keeps the computer awake, and lets it sleep again
once nothing is running. An agent waiting for your approval or answer does not count as working. The
screen can still turn off, and closing a laptop lid still puts it to sleep. Turn this off in
**Settings → Maintenance → Keep computer awake**.

The `up` background service does not do this. On a host that runs it, set the system never to
sleep, or start the server under `caffeinate -i` (macOS) or `systemd-inhibit` (Linux).

## Is there voice input?

Yes, on web and desktop. Transcription runs on one of your own Up.computer computers, so pick one
first in **Settings → Voice**. The transcript goes into your draft for you to review before sending.
See [Voice input](./voice-input.md).

## Why is my agent not showing up?

Almost always, its CLI is not installed or not on the `PATH` of the computer that runs Up.computer.
Sign in on that computer first, for example with `codex login` or `claude auth login`. Still
missing? Set **Binary path** in that agent's settings under **Settings → Providers**. Version
managers often cause this. See [Provider setup](./install.md#providers).

## How do I give feedback or report a bug?

Open an issue on [GitHub](https://github.com/krl-gr/upcomputer/issues). Search first, and keep each
report to one problem. Steps to reproduce, your OS and the app version help a lot.

Ideas and feature requests are welcome as issues too. For anything private, email
**support@up.computer**. Report security problems only by email, never in a public issue.
