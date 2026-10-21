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
session that would not open, and `app.first_thread_created` and
`app.first_message_sent` mark first use. Milestones are claimed with marker files in
the state directory, and only for installs first launched by a build that has them,
so an upgraded install does not report a second first thread.

## Delivery

A send can fail after PostHog has stored the batch, so every retry is a copy.
[Delivery](../../apps/server/src/telemetry/AnalyticsService.ts) gives each event a
uuid when it is recorded, backs off after a failed send, and drops a batch after a
few tries. Without these limits, one stuck batch was sent every second for days.

## Collection boundary

Keep analytics payloads to product metadata and normalized measurements. Do not
send prompts, authentication material, raw provider payloads, user-assigned device
names, provider instance IDs (users name them), paths, error text, or conversation
identifiers. Classify errors into a bounded category on the server. Client metadata is best effort; invalid values
must not reject a connection. PostHog person profiles remain disabled.
