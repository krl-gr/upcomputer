# Provider architecture

The web app communicates with the server via WebSocket using a simple JSON-RPC-style protocol:

- **Request/Response**: `{ id, method, params }` → `{ id, result }` or `{ id, error }`
- **Push events**: typed envelopes with `channel`, `sequence` (monotonic per connection), and channel-specific `data`

Push channels: `server.welcome`, `server.configUpdated`, `orchestration.domainEvent`. Payloads are schema-validated at the transport boundary (`wsTransport.ts`). Decode failures produce structured `WsDecodeDiagnostic` with `code`, `reason`, and path info.

Methods mirror the `NativeApi` interface defined in `@upcomputer/contracts`:

- `providers.startSession`, `providers.sendTurn`, `providers.interruptTurn`
- `providers.respondToRequest`, `providers.stopSession`
- `shell.openInEditor`, `server.getConfig`

Codex is the only implemented provider. `claudeCode` is reserved in contracts/UI.

## Client transport

`wsTransport.ts` manages connection state: `connecting` → `open` → `reconnecting` → `closed` → `disposed`. Outbound requests are queued while disconnected and flushed on reconnect. Inbound pushes are decoded and validated at the boundary, then cached per channel. Subscribers can opt into `replayLatest` to receive the last push on subscribe.

## Server-side orchestration layers

Provider runtime events flow through queue-based workers:

1. **ProviderRuntimeIngestion** — consumes provider runtime streams, emits orchestration commands
2. **ProviderCommandReactor** — reacts to orchestration intent events, dispatches provider calls
3. **CheckpointReactor** — captures git checkpoints on turn start/complete, publishes runtime receipts

All three use `DrainableWorker` internally and expose `drain()` for deterministic test synchronization.

## Custom instructions

`ServerSettings.customInstructions` holds text the user writes once and every agent follows (default empty, trimmed, patches limited to 20,000 characters). `ProviderService` reads it on every session start and recovery and passes it to the adapter as `ProviderAdapterStartSessionInput.customInstructions`; request payloads cannot set it. Adapters format it with `provider/CustomInstructions.ts` and add it to the model prompt only:

| Harness      | Channel                                                                       |
| ------------ | ----------------------------------------------------------------------------- |
| Claude       | `systemPrompt: { preset: "claude_code", append }`                             |
| Codex        | Every turn's `additionalContext` (collaboration mode on Codex before 0.141)   |
| OpenCode     | `system` on every `session.promptAsync`                                       |
| Cursor, Grok | ACP has no system prompt: leading text block of the first prompt of a session |
| Pi (pro)     | Appended system prompt of the Pi resource loader                              |

A running session keeps the text it started with. A change applies to new sessions and to a session's next start or resume: after a restart, after the idle reaper (30 minutes) stops it, or when the provider session is replaced. With an empty value, adapter inputs and outputs are unchanged.
