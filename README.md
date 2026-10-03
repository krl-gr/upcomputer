# Up.computer

The self-orchestrating control plane for coding agents.

Up.computer brings the agent CLIs you already use into one free, open-source
desktop app. Talk an idea through in a chat and it becomes a task that a
worker agent picks up in the background, on Codex, Claude Code, Cursor CLI,
Grok Build, or OpenCode. Each agent runs on your own
subscription, and every chat stays on your computer.

## Status

Bug reports and focused feedback are welcome. Large feature work should start
with an issue before a pull request.

## Install

Download the app from [up.computer/download](https://up.computer/download/) or the
[latest release](https://github.com/krl-gr/upcomputer/releases/latest). Builds are published for
macOS (Apple Silicon and Intel), Windows, and Linux, straight from this repository. The macOS
builds are signed and notarized. The Windows installer is not signed yet, so SmartScreen shows a
warning on first launch. Installed apps update themselves from GitHub releases.

Up.computer runs the provider CLIs you install. Install and authenticate any you want to use:

- Codex CLI: install the [Codex CLI](https://developers.openai.com/codex/cli)
  and run `codex login`.
- Claude Code: install [Claude Code](https://claude.com/product/claude-code)
  and run `claude auth login`.
- Cursor CLI: install [Cursor CLI](https://cursor.com/cli) and run
  `cursor-agent login`.
- OpenCode: install [OpenCode](https://opencode.ai) and run
  `opencode auth login`.

Codex and Claude are on by default. Cursor, Grok, and OpenCode are off by default; turn them on in
**Settings** → the provider's card when you want to use them.

Package-manager installs such as Homebrew, winget, and AUR are not an official
install path yet.

## Run From Source

Requirements:

- Vite+ `vp`
- Node 24.13.1+
- Git
- At least one supported coding-agent CLI, installed and authenticated

Install Vite+:

```bash
curl -fsSL https://vite.plus | bash
```

Install dependencies and run the app:

```bash
vp install
vp run dev
```

Useful development commands:

```bash
vp run dev:web
vp run dev:server
vp run start:desktop
vp run dev:marketing
```

## What It Does

- Run multiple coding-agent CLIs from one desktop GUI.
- Keep agent work grouped into project threads instead of scattered terminal
  sessions.
- Review changed files and diffs before trusting or shipping a run.
- Commit, push, publish repositories, and open pull requests from the app.
- Track work as tasks, let saved task agents pick them up by status and tag,
  and create tasks on a schedule. See [Tasks, agents, and automations](./docs/tasks/README.md).
- Give every agent a managed browser and native desktop observation and control. See
  [Browser and computer use](./docs/computer-use/README.md).
- Work against local projects with the desktop app's built-in backend.
- Preserve existing remote-environment records while official remote support remains unavailable.

## Repository Layout

- `apps/desktop`: Electron desktop shell and desktop release integration.
- `apps/server`: Node.js server that brokers provider sessions and serves the
  web app.
- `apps/web`: React/Vite application for the main product UI.
- `apps/marketing`: Astro marketing and download site.
- `packages/contracts`: Shared Effect Schema contracts for provider events,
  WebSocket protocol, settings, and session types.
- `packages/shared`: Shared runtime utilities consumed by server and clients.
- `packages/ssh` and `packages/tailscale`: Remote-environment support.
- `packages/tasks-*`: Tasks, task agents, and automations.
- `packages/computer-use-*`: Browser automation and computer use.
- `docs`: User-facing and operational docs.

## Relationship To T3 Code

Up.computer is built as a fork of the open-source T3 Code project:

<https://github.com/pingdotgg/t3code>

This fork keeps the upstream runtime, provider orchestration, contracts,
desktop infrastructure, and release plumbing close to upstream while developing
a different product direction, UI, branding, and workflow layer.

A few internal identifiers, such as metric names, log labels, and dev tooling, still carry T3 Code names. Packages, the application identity, protocol links, updates, and data directories use Up.computer names.

## Contributing

The project is early and the architecture is still settling. Small, focused bug
fixes, reliability improvements, performance improvements, and clear docs fixes
are the easiest contributions to review.

If you want to make a non-trivial product, UI, or architecture change, open an
issue first so scope can be discussed before you spend time on a large branch.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## Security

Please do not report security vulnerabilities in public issues. See
[SECURITY.md](./SECURITY.md) for the current reporting process.

## License And Brand

The source code is MIT licensed. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md). Release
builds also bundle third-party components under their own licenses.

The MIT license does not grant trademark rights in the Up.computer name, logo,
or visual identity. You may use the name to refer to this project, but do not
use the branding in a way that implies endorsement or an official build unless
you have permission.

Licensing, privacy, security, or support questions: **support@up.computer**.
