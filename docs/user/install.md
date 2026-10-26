# Install Up.computer

Up.computer runs coding agents on your computer and lets you control them from its
desktop or web app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch Up.computer and configure providers afterwards.

## Command line

The `up` command comes with the desktop app (see [below](#the-up-command)); a
standalone download is not published yet.

| Task                                             | Command                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| Start the server and open the web app            | `up`                                                                    |
| Start the server without a browser               | `up serve`                                                              |
| Keep it running in the background (macOS, Linux) | `up service install` ([details](./background-service.md))               |
| Reclaim database space                           | `up doctor` ([details](./background-service.md#reclaim-database-space)) |

Run `up help` or `up --help` for the full reference. To start in a new working
directory, use an explicit path such as `up ./my-project`. A bare directory name
is accepted only if it already exists.

If `up` or `up start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

## Desktop app

Download Up.computer for macOS, Windows or Linux from
[up.computer](https://up.computer/download) or from
[GitHub Releases](https://github.com/krl-gr/upcomputer/releases). On Debian and
Ubuntu, install the `.deb` with `sudo apt install ./Up.computer-*.deb`.

The desktop app updates itself. The `.deb` asks for your password to install
each update. If your desktop has no password prompt, the update fails. Download
the new `.deb` and install it the same way.

### The `up` command

The desktop app includes the `up` command-line tool. To run it from any
terminal, open **Settings → General → About** and choose **Install** next to
**up command**. On macOS and Linux it adds an `up` link to a folder on your
`PATH`; on Windows it adds the app's command folder to your `PATH`. Open a new
terminal afterwards. **Remove** takes it off again.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. Up.computer installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
up app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `up app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Up.computer has no mobile app of its own yet. Upstream's Up.computer mobile app can
connect to an Up.computer server through a pairing URL; see
[remote access](./remote-access.md).

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Up.computer's provider settings.                                                                                     |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |

Provider CLIs must be on the server's `PATH`. If Up.computer cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Up.computer warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when Up.computer cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with Up.computer. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Up.computer does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Pi](./providers-pi.md), and
[Muse Code](./providers-muse.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Up.computer](./updating.md): update the app and connected servers.
