# Up.computer

The desktop workspace for coding-agent CLIs.

Up.computer runs coding-agent CLIs from one visual surface. Keep Codex CLI,
Claude Code, Cursor CLI, OpenCode, your editor, and your git workflow. Add
durable threads, terminals, diffs, branches, source-control actions, and local
Desktop environment controls around them.

## Status

Up.computer is an alpha project. It is usable, but the app and repository are
moving quickly. Expect rough edges, incomplete docs, and occasional breaking
changes while the product direction settles.

Bug reports and focused feedback are welcome. Large feature work should start
with an issue before a pull request.

## Install

This public repository produces **Up.computer Core**, the MIT-licensed core-only
composition. Build it from source using the instructions below.

The normal official Up.computer installer is assembled by a separate private
release pipeline from this exact public core plus bundled first-party
extensions. It is still one Up.computer application, but the complete official
binary is not represented by this public source tree alone.

The official installer includes the built-in **Up** agent runtime, so a user can install
Up.computer, sign in or configure a supported BYOK provider, and start without installing a
third-party harness. Browser and Computer Use are integrated through that runtime. The current
release is local Desktop only; it does not distribute an official npm CLI or headless server. The
public npm package named `t3` belongs to upstream T3 Code and is not an Up.computer install path.

The public Core source also supports external provider CLIs. Install and authenticate any optional
runtime you want to use:

- Codex CLI: install the [Codex CLI](https://developers.openai.com/codex/cli)
  and run `codex login`.
- Claude Code: install [Claude Code](https://claude.com/product/claude-code)
  and run `claude auth login`.
- Cursor CLI: install [Cursor CLI](https://cursor.com/cli) and run
  `cursor-agent login`.
- OpenCode: install [OpenCode](https://opencode.ai) and run
  `opencode auth login`.

Package-manager installs such as Homebrew, winget, and AUR are not an official
install path yet.

## Run From Source

Requirements:

- Vite+ `vp`
- Node 24.13.1+
- Git
- A supported external coding-agent CLI installed and authenticated when running Core without the
  private built-in Up runtime

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
- Use integrated terminals in the same project/worktree context.
- Commit, push, publish repositories, and open pull requests from the app.
- Work against local Desktop projects and use T3 Connect with the bundled Desktop backend.
- Preserve existing remote-environment records while official remote support remains unavailable.

## Repository Layout

- `apps/desktop`: Electron desktop shell and desktop release integration.
- `apps/server`: Node.js server that brokers provider sessions and serves the
  web app.
- `apps/web`: React/Vite application for the main product UI.
- `apps/marketing`: Astro marketing and download site.
- `apps/mobile`: Experimental Expo/React Native app.
- `packages/contracts`: Shared Effect Schema contracts for provider events,
  WebSocket protocol, settings, and session types.
- `packages/shared`: Shared runtime utilities consumed by server and clients.
- `packages/ssh` and `packages/tailscale`: Remote-environment support.
- `docs`: User-facing and operational docs.

## Relationship To T3 Code

Up.computer is built as a fork of the open-source T3 Code project:

<https://github.com/pingdotgg/t3code>

This fork keeps the upstream runtime, provider orchestration, contracts,
desktop infrastructure, and release plumbing close to upstream while developing
a different product direction, UI, branding, and workflow layer.

Some internal package names, storage keys, and compatibility environment variables intentionally
retain T3 Code identifiers so existing profiles keep working and upstream changes remain practical
to merge. Public application identity, protocol links, update identity, and new data directories use
Up.computer names.

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

The public Core source code is MIT licensed. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).
Official installers can additionally contain proprietary first-party extensions and third-party
components under their own licenses.

The MIT license does not grant trademark rights in the Up.computer name, logo,
or visual identity. You may use the name to refer to this project, but do not
use the branding in a way that implies endorsement or an official build unless
you have permission.

Licensing, privacy, security, or support questions: **support@up.computer**.
