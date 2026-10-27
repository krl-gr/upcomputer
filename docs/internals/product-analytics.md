# Product analytics

The server owns PostHog delivery, opt-out, and identity for every connected client.
[Identity selection](../../apps/server/src/telemetry/Identify.ts) hashes an available
provider account ID, falling back to an installation-scoped ID. The first identity an
install resolves is pinned in its state directory: a provider login creates the
account file mid-onboarding, and without the pin the next launch reported as a new
user. This identity can span several clients; it does not identify a browser
session. Clients do not load the PostHog browser SDK. UI events go through the
`server.recordClientEvent` RPC, so they carry the same identity and opt-out as server
events. Client-use events require an authenticated connection, so visiting the hosted
app without connecting does not count as product use.

## Test traffic

Most identities in the project were our own dev, e2e and test-build runs, so every
event carries `buildKind`, `isInternal` and `sessionId`. Product reports should keep
`isInternal = false` and the build kinds real users run (`stable`, `rc`, `nightly`).

- `buildKind` comes from build metadata only. The packaged desktop app derives it from
  its version and passes it to its backend; an unpackaged app is `dev`, and its
  `desktopVersion` is the workspace version, since Electron then answers
  `app.getVersion()` with its own. Other servers classify themselves, and a server run
  from source (no bundle define) is `dev`. Local test and demo builds are `localtest`,
  preview builds `nightly`. `releaseChannel` is only set by builds with an update feed.
- `isInternal` is the `telemetry-internal-device` file in the state directory, read for
  every event. It is a file because env vars do not reach apps started from Finder or
  the Dock, and the state directory survives updates. Settings > Diagnostics has the
  switch; creating the file by hand works too.
- `sessionId` is a random UUID per desktop app launch, kept across backend restarts, or
  per server start. Client events share the server's session, so one session can span
  several windows and devices.

## Attribution boundaries

Client dimensions belong to the event's WebSocket connection. A server-global
"current client" would misattribute simultaneous web, desktop, and mobile use.
Provider execution has its own events because a turn can outlive the requesting
connection.

Keep client and server dimensions separate. A desktop host can serve a phone or a
remote browser, and a direct connection can cross a network. Older clients omit
metadata. Missing client values must stay unknown rather than being backfilled
from server properties. The legacy `clientType` property describes how the server
runs; use `surface` for the connected client.

## Interpreting events

Use `client.turn.requested` for active-use reports. `client.connected` counts
reconnects, so network behavior can inflate it. One identity can appear in several
client groups during a period; adding those groups double-counts users.

Provider send and completion counts need not match. Providers can emit synthetic
turns without a send request. Collection is best effort, with no scan or backfill
of provider history.

Token totals cover the main agent. Child agents and model rerouting prevent a turn
from representing one provider/model combination's full cost. For provider
comparisons, require complete usage, no observed subagents, and no mixed models;
compare matching model, effort, interaction mode, and terminal status. Aggregate
output/input ratios should divide the summed totals. Averaging per-turn ratios
lets small-input turns dominate.

Unknown counts stay absent. Partial usage contains valid observed counts but
cannot establish a whole-turn total. Keep these distinctions when changing token
normalization or building reports.

## Onboarding funnel

Measure a new install with ordered steps for one identity, not period-wide counts.
`app.first_launch` starts it. `app.launched` is a desktop launch and
`server.started` with `startupContext: "restart"` is a backend restart inside one.
`server.stopped.uptimeMs` is the desktop session length, and
`client.disconnected.connectedMs` covers a closed window or tab.

Read the latest `provider.status.observed` per provider to tell "no CLI", "CLI but
signed out" and "ready" apart; it is sent when the state changes, so an install or
login landing shows up as a change. First-run setup sends `onboarding.*` events per
step and per agent action, and `flow` says which screens sent them. Without it they
come from upstream's wizard (builds before the agent table, hosted web, and the `upstream`
`onboarding` surface): `step` is `connection`, `agents`, then `import`, always in that
order. `flow: "upcomputer"` is our agent table, which has one step, `agents` (the table and
each agent's own screen): it completes with `continued` as soon as an agent works and
with `skipped` from the close button, then `onboarding.completed` follows. It never
sends `connection` or `import`, so funnels comparing the flows should stop at
`agents`. `flow: "first_run"` is no screen at all: the desktop app opens a new user's
workspace directly and installs OpenCode, sending `onboarding.first_run_agent` with
`outcome` `started`, then `ready` (followed by `onboarding.completed`) or `failed`, and
`retried` or `connect_other` from the composer's buttons. `started` and `failed` are sent
once per install operation, so a Retry that downloads again sends both again. `started`
means the app began installing its own OpenCode; `ready` without `started` is a new user
whose own agent, or own OpenCode, already worked, so nothing was downloaded. The download itself is
`provider.install.*` with `provider: "opencode"`. `onboarding.step.completed` with
`step: "agents"` and
`readyProviders: 0` is a user who left setup without a working agent, and
`onboarding.agent.terminal_closed` with `installed: false` after an install is an
install that did not finish, or a CLI outside the PATH the server searches. `composer.provider_setup.*` records where "Open
provider settings" sends them. `provider.readiness.failed.errorCategory` explains a
session that would not open (see Failure categories), and `app.first_thread_created` and
`app.first_message_sent` mark first use. Later first uses are `app.first_task_created`,
`app.first_agent_created`, `app.first_automation_created`,
`app.first_scheduled_task_created` (`trigger` is `schedule` or `webhook`),
`app.first_agent_run` and `app.first_bot_chat`. `via` says whether the person made it in
the app or asked an agent, which used a task tool; tasks that imports, automations or
bots create on their own are not first uses. Milestones are claimed with marker files in
the state directory, and only for installs first launched by a build that has them,
so an upgraded install does not report a second first thread.

## Failure categories

`provider.readiness.failed.errorCategory` is read from error tags, JSON-RPC and errno
codes and structured fields, never from text: matching messages classified every
failure as `unknown`, and adapter errors nest through wrappers and PlatformError
reasons. The [classifier](../../apps/server/src/telemetry/ProviderTelemetry.ts) takes
the outermost decisive error. A new failure that only its message tells apart needs a
structured field, as `OpenCodeRuntimeError.reason` has. Claude and Cursor open sessions
lazily, so their missing CLI or sign-in failures show up at the first turn instead.

`provider.mcp.attach` is sent when a session's MCP status changes: `server: "t3"` for
our own server, with `outcome` `attached`, `failed`, `timeout` or `disconnected` and a
bounded `reason`, and `server: "user"` when the user's own servers start failing, fail
more, or recover. `userServerCount` and `failedCount` are counts; the names stay in the
thread's provider session, where the composer notice reads them. Claude reports
`disconnected` from a turn's init or the status probe after each result, Codex from the
t3-code `runtimeStatus` read after each root turn, so a drop shows one turn late at most.
Codex gives a startup failure only as text plus a reauthentication flag; the adapter
reads a timeout from that text and sends only the enum.

`provider.turn.completed` carries `failureClass` and `retryable` for failed and
interrupted turns. The usage arrives with `provider_turn.updated` and the failure with
`turn.terminal`, in either order, so the ingestor records the turn once it has both, or
after 30 seconds without a failure class.

## Errors and crashes

`app.error` is our own event, not a third-party tracker, so it carries only what the
[fingerprint](../../packages/shared/src/errorFingerprint.ts) keeps: a class name from
`APP_ERROR_CLASSES` in contracts (anything else is `other`), the file name of the first
frame, and a hash of each frame's function and file name. Messages, stack text, paths and
line numbers never leave the process that saw the error, so the hash is the same on every
machine and across builds whose function names do not change. To make a new class
visible, add it to the whitelist; never send its name unchecked, since dependencies and
runtime code define classes too. The server deduplicates per `where` and stack hash and
caps each process; web pages and the desktop main process deduplicate and cap again
before sending, because a render or retry loop repeats one error thousands of times.

Crash hooks must not change what a crash does. The server observes uncaught errors with
`uncaughtExceptionMonitor`, so Node still exits, and writes the error to
`telemetry-pending-errors` for the next start, which sends it under the session that
crashed. The Cursor SDK's rejection guard exits on its own instead of letting Node do
it, so it notifies those monitors first, as Node does. Electron's main process only
warns about unhandled rejections and keeps running after an uncaught error, so the
desktop app listens to both and sends them live. Defects reach `app.error` through the
RPC server's error reporter and when one ends the server.

The desktop main process has no identity or opt-out of its own, so `desktop.*` events
and its errors go to the primary backend over the telemetry pipe. They wait in a small
queue while no backend runs, which is how a backend's own `desktop.backend.exited`
reaches the backend that replaces it.

`app.unclean_exit` comes from a marker the server writes at start and removes at a clean
stop. A desktop backend restart keeps the app's session, so `previousSessionId` equal to
`sessionId` is a backend that died inside a running app; a different one is an app or
server that did not stop. A start after ten unclean starts within an hour records
nothing until it has stayed up for ten minutes, so a crash loop cannot flood PostHog.

## Views and clicks

`app.view.opened` names the section a window shows, `ui.click` a click on a
button, link, tab or menu item there, and `app.session.ended` (server-side, when a
connection that reported views closes) the views it saw and how long it stayed
connected. A reconnect starts a new session, and the window reports its current view
again on every connection.

The [click listener](../../apps/web/src/uiAnalytics.ts) reads nothing from the page
but the control's role and its `data-track` name. Our buttons, links and their
labels, titles and hrefs carry thread, task and project names and ids, so text-based
capture, PostHog autocapture or session replay would leak them. A control without a
valid name counts as `untracked`, which still shows click volume per view; name a
control by adding `data-track="area.action"` where it is rendered. The view comes from
the route's shape, never its params; a section the URL does not tell apart names
itself with `useAnalyticsView`, as `/tasks` does for the planner and automations. Clicks
are counted only while the primary environment is connected, folded when the same
control is clicked again within a second, and capped per minute.

## Delivery

A send can fail after PostHog has stored the batch, so every retry is a copy.
[Delivery](../../apps/server/src/telemetry/AnalyticsService.ts) gives each event a
uuid when it is recorded, backs off after a failed send, and drops a batch after a
few tries. Without these limits, one stuck batch was sent every second for days.

## Collection boundary

Keep analytics payloads to product metadata and normalized measurements. Do not
send prompts, authentication material, raw provider payloads, user-assigned device
names, provider instance IDs (users name them), paths, error text, or conversation
identifiers. Classify errors into a bounded category or a whitelisted class name. Client metadata is best effort; invalid values
must not reject a connection. PostHog person profiles remain disabled.
