# Activation and reliability telemetry

The versioned activation contract is defined in
`apps/server/src/telemetry/ActivationFunnel.ts`. Contract events carry
`schemaVersion: 1`. Existing `server.boot.heartbeat`, `provider.session.*`, and
`provider.turn.sent` events remain unchanged for dashboard compatibility.

## Event catalog

| Event                          | Emission point                                                                                                                                          | Required event properties                                                   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.first_launch`             | First primary desktop backend startup for an installation after telemetry is enabled                                                                    | `schemaVersion`                                                             | Attempted once per installation marker, across restarts and upgrades. Launches while opted out do not read or write the marker; enabling later makes the next desktop launch the first measured launch.                                                                                                                                                                                                                                                                                 |
| `app.launched`                 | First primary backend process run in a desktop process                                                                                                  | `schemaVersion`, `startupContext=desktop-launch`                            | Human-perceived desktop launch. Never emitted for backend restart, CLI, or secondary WSL backend.                                                                                                                                                                                                                                                                                                                                                                                       |
| `server.started`               | Every server runtime startup                                                                                                                            | `schemaVersion`, `startupContext`                                           | Process startup. Context is one of `desktop-launch`, `desktop-restart`, `desktop-secondary`, `desktop-unknown` (legacy/malformed desktop bootstrap), `cli-browser`, or `cli-headless`.                                                                                                                                                                                                                                                                                                  |
| `provider.readiness.succeeded` | Provider adapter returns a ready new or resumed session                                                                                                 | `schemaVersion`, `provider`, `interactionMode`, bounded `readinessBoundary` | Trustworthy session readiness. `readinessBoundary` is `session-ready` for an explicit start or `session-recovery` for a persisted-session resume. It does **not** claim that separate authentication was observed. Adopting an already-active session does not emit a new readiness event because no new adapter readiness boundary occurred.                                                                                                                                           |
| `provider.readiness.failed`    | Provider adapter new-session start or persisted-session resume fails                                                                                    | previous fields plus bounded `errorCategory`                                | Session readiness failure. `readinessBoundary` is `session-start` or `session-recovery`. Providers without a separate auth status boundary are not guessed as auth success/failure.                                                                                                                                                                                                                                                                                                     |
| `provider.turn.submitted`      | Validated turn is handed to the routed adapter                                                                                                          | `schemaVersion`, `provider`, `interactionMode`                              | User submission/attempt, before provider acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `provider.turn.completed`      | Canonical `turn.completed` has state `completed`                                                                                                        | previous fields plus numeric `durationMs`, bounded `durationBucket`         | Successful first value: an actually completed provider turn.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `provider.turn.terminated`     | Adapter submission failure, failed/cancelled/interrupted canonical terminal event, explicit interrupt/stop, or session exit with an active tracked turn | terminal timing fields plus bounded `outcome` and `errorCategory`           | Terminal non-success. Intentional `stopSession`, stale-session replacement, and shutdown `stopAll` record `cancelled` only after the adapter stop succeeds; a failed stop leaves the turn tracked for a later trustworthy runtime terminal event. A runtime exit records `provider-crash` only for `exitKind=error`; `graceful` records `cancelled`, and an unspecified exit kind records `failed/unknown`. In-process turn keys suppress duplicate terminal events and are never sent. |

All events also receive common delivery properties from `AnalyticsService`:
`platform`, `arch`, `clientType`, `serverVersion`, legacy `t3CodeVersion`, and,
when the desktop supplied them, `desktopVersion` and `releaseChannel`.

## Privacy and cardinality

Never add prompt/response text, file or repository paths, commands, raw error
messages/exceptions, provider account IDs, thread/turn IDs, or credentials.
Only bounded enums and numeric durations are accepted by the activation
builders. Model is deliberately omitted from the new contract because custom
model strings are not bounded; the legacy `provider.turn.sent.model` remains
for compatibility. Error classification uses a bounded error tag mapping and
never serializes a cause. Telemetry-disabled mode is a no-op, including the
first-launch marker.

A submission is registered at the canonical `turn.started` boundary, before
adapters that await the full provider prompt can publish `turn.completed` and
return from `sendTurn`. The eventual adapter return reconciles the same
in-process turn key without replacing the original submission timestamp. This
prevents an early terminal event from being dropped or later misclassified as a
cancellation; failed sends remove their pending registration and still emit at
most one terminal outcome.

A `sendTurn` call made while the same thread/provider already has a tracked
canonical turn is a steering submission. It still emits `provider.turn.submitted`
as an attempt, but it does not create another canonical turn registration. A
successful steer reconciles to the already-active turn key; a failed steer emits
no `provider.turn.terminated` because the underlying provider turn remains
running. Its eventual canonical completion/failure is the sole terminal outcome,
measured from the original submission. Reliability queries must therefore treat
terminal events as canonical-turn outcomes rather than require one terminal per
submission attempt.

A hard process kill cannot execute server code. A provider `session.exited`
event is classified as `provider-crash` only when the runtime explicitly reports
`exitKind=error` while an in-process submitted turn is active. Graceful or
unspecified exits are bounded non-crash outcomes. Intentional service stops
terminalize active turns as `cancelled` only after adapter shutdown succeeds,
so a failed stop cannot suppress a later completion. Runtime events emitted by
a successful stop win the race and make the post-stop cancellation a no-op. No
synthetic success or crash is invented after an unobservable machine/process
termination.

## Ordered first-value funnel

Use one anonymous telemetry identity and timestamp ordering; do not compare
period-wide unique counts:

```text
first_launch := min(timestamp where event = 'app.first_launch')
provider_ready := min(timestamp where event = 'provider.readiness.succeeded'
                      and timestamp >= first_launch)
first_prompt := min(timestamp where event = 'provider.turn.submitted'
                    and timestamp >= provider_ready)
first_value := min(timestamp where event = 'provider.turn.completed'
                   and timestamp >= first_prompt)

count identities at each ordered step;
report conversion between adjacent steps and
median/p75/p90(first_value - first_prompt).
Break down failures using provider.turn.terminated outcome/errorCategory and
server.started startupContext. Exclude no context values silently; report them
as data-quality failures.
```
