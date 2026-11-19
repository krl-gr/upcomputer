# Up.computer docs

## Getting started

- [Getting started](./user/getting-started.md): from install to your first task done by a worker.
- [Install Up.computer](./user/install.md)
- [First launch and setup](./user/welcome-wizard.md)
- [FAQ](./user/faq.md)
- [Threads from older Up.computer versions](./user/thread-migration.md)

## Using Up.computer

- [Messages and context](./user/composer.md)
- [Working with threads](./user/thread-sidebar.md)
- [Activity log](./user/activity-log.md)
- [Permission modes](./user/permission-modes.md)
- [Terminal history](./user/terminal.md)
- [Source control](./user/source-control.md)
- [Project settings](./user/project-settings.md)
- [Appearance and themes](./user/appearance.md)
- [Keyboard shortcuts](./user/keybindings.md)
- [Voice input](./user/voice-input.md)
- [Text generation models](./user/text-generation.md)
- [SnapShots](./user/snap-shot.md)
- [Visual replies](./user/html-renders.md)
- [Prompt links](./user/prompt-links.md)
- [Import browser sessions](./user/browser-import.md)
- [Use Up.computer as your default browser](./user/default-browser.md)
- [Devices](./user/devices.md)
- [Usage and limits](./user/usage.md)
- [Secrets](./user/secrets.md)
- [Product usage data](./user/telemetry.md)
- [Remote access](./user/remote-access.md)
- [Guest links](./user/guest-links.md)
- [UpComputer Connect troubleshooting](./user/t3-connect-troubleshooting.md)
- [Outside agents (MCP)](./user/outside-agents.md)
- [Running in the background](./user/background-service.md)
- [Updating Up.computer](./user/updating.md)
- [Open source licenses](./user/open-source-licenses.md)

## Tasks, workers, bots and automations

- [Tasks and the planner](./user/tasks.md): statuses, tags, your own tasks and your days.
- [Workers](./user/workers.md): agents that do tasks in the background, and how to talk to a run.
- [Bots](./user/bots.md): one permanent chat with its own memory.
- [Automations](./user/automations.md): tasks created on a schedule.

## Agents

- [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md) ·
  [Cursor](./user/cursor.md) · [OpenCode](./user/providers-opencode.md) ·
  [Antigravity](./user/providers-antigravity.md) · [Kiro](./user/providers-kiro.md) ·
  [Pi](./user/providers-pi.md) · [Muse Code](./user/providers-muse.md) · [fx](./user/providers-fx.md)
- [ACP providers](./user/providers-acp.md): agents from the ACP Registry or a local ACP command.

---

## Working on Up.computer

Start with the [development runbook](./operations/development.md) and
[contribution policy](../CONTRIBUTING.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Product flags](./internals/product-flags.md)
- [Branding](./branding.md)
- [Connection runtime](./internals/connection-runtime.md)
- [Providers](./internals/providers.md)
- [Adding a provider](./internals/adding-a-provider.md)
- [Pull request file revisions](./internals/pull-request-file-revisions.md)
- [Model classification](./internals/model-manifest.md)
- [Remote environments](./internals/remote.md)
- [Server updates](./internals/server-updates.md)
- [Resource telemetry](./internals/resource-telemetry.md)
- [Product analytics](./internals/product-analytics.md)
- [Environment auth](./internals/environment-auth.md)
- [UpComputer Connect](./internals/t3-connect.md)
- [Assistant citations](./internals/assistant-citations.md)
- [Mobile layout](./internals/mobile-layout.md)
- [Mobile navigation](./internals/mobile-navigation.md)
- [Mobile development lifecycle](./internals/mobile-development.md)
- [Terminal runtime](./internals/terminal-runtime.md)
- [Devices](./internals/devices.md)
- [Voice input](./internals/voice-input.md)

### Runbooks

- [Development and local builds](./operations/development.md)
- [Scenarios: real-app proof for a fix](./operations/scenarios.md)
- [Upstream sync](./operations/upstream-sync.md)
- [UpComputer Connect setup](./operations/upcomputer-connect-setup.md)
- [Connect setup (upstream)](./operations/connect-setup.md)
- [Release](./operations/release.md)
- [Observability](./operations/observability.md)
- [Relay observability](./operations/relay-observability.md)
- [Mobile app store screenshots](./operations/mobile-app-store-screenshots.md)

### User guides for features Up.computer hides

These pages describe upstream features that the Up.computer build does not show (see
[product flags](./internals/product-flags.md)). They stay so upstream syncs stay cheap.

- [Devices](./user/devices.md): hidden by the `devices` flag.
- [Triage an issue](./user/triage.md): hidden by the `triage` flag. Its playbook files issues
  upstream.
- [Mobile notifications](./user/mobile-notifications.md): needs upstream's mobile app, which
  Up.computer does not publish.
