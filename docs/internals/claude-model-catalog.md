# Claude model catalog

Backported from upstream T3 Code revision `f5ef0ddb90a8c36584e181b1913e7b8a5df30ffc`:
`ModelManifest.ts`, `ClaudeModelManifest.ts`, `ClaudeModelCatalog.ts`, their
focused tests, and the Claude portion of `model-manifest.json`. Upstream license
and attribution are retained. This is not a merge of the rest of upstream.

## Behavior

- The bundled catalog supports offline startup, including Opus 5.5. That entry
  requires Claude Code 2.1.280 or newer. The installed/configured CLI version,
  not the application's version, gates availability.
- The server reads public metadata from
  https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json .
  This optional upstream data feed is not a connection to a T3 account/server and
  receives no credentials, conversation data, or prompts. No hosted UpComputer
  catalog service is provisioned or claimed by this change.
- Provider checks start a background refresh, at most once per hour. Failed
  requests have a five-minute cooldown and a ten-second timeout. The regular
  five-minute provider check observes new data; startup/current reads do not
  wait for the network. **Refresh provider status** forces a catalog refresh
  before rebuilding that instance's snapshot.
- `enableProviderUpdateChecks: false` disables catalog network requests too,
  including explicit refreshes, but continues using saved/bundled metadata.
- Last-good data is saved atomically as `<stateDir>/model-manifest.json`.
  Invalid responses, duplicate models, missing profiles/defaults, invalid
  Claude runtime mappings and older remote data never replace it. A newer
  bundled edit supersedes older disk data. Corrupt/missing caches fall back
  to the bundle.
- Public metadata is process-shared. Account probes, configuration, sessions,
  and authorization remain isolated per Claude instance.

## Models and dispatch

The same catalog supplies the picker, version requirements, reasoning/thinking
options, fast mode, context size, model suffixes and effort mappings used by both
the SDK adapter and CLI text generation. Refreshes are read at runtime, not frozen
when a driver is created. Existing model selections are not rewritten.

Custom model strings remain supported and opaque; a custom string that shadows
an alias is not silently rewritten. Our existing wire contracts are retained:
legacy models get a display-name suffix rather than importing upstream's wider
legacy/badge/default-classification UI system. Codex, Pi and other providers'
discovery and compatibility policies are not changed.

New models using supported catalog fields can arrive without an application
release. A genuinely new Claude protocol feature may still require adapter work.
Catalog presence is not proof of account entitlement or successful paid inference.

## Verification

Focused tests cover TTL/cooldown, concurrent readers, force refresh, timeout,
offline cache reload, malformed data, version boundaries, alias handling and
SDK/CLI dispatch of synthetic models. The composed web/backend verification uses
a fake Claude executable and an isolated profile: Opus 5.5 is listed and selected;
a newer saved synthetic model appears after an offline restart of the same
verification backend. No model prompts, real profile transfer, installed Alpha
restart, desktop packaging, or release publication are part of these checks.
