# Relay observability

The relay Alchemy stack owns a focused Axiom trace setup:

- `upcomputer-relay-traces-prod`, an OpenTelemetry trace dataset for Worker requests
- `upcomputer-relay-otel-ingest-prod`, a dataset-scoped ingest token bound to the Worker
- `upcomputer-relay-recent-spans-prod`, a view of recent request and endpoint spans

Alchemy stages append their sanitized stage name to isolate resources, for example
`upcomputer-relay-traces-dev-julius` for a personal stage.

Deploy from `infra/relay` with the normal Alchemy workflow:

```sh
vp run deploy
```

Alchemy resolves Axiom deployment credentials through its provider. At runtime, the Worker
receives only the scoped ingest token; it does not receive the diagnostics query token.

The Worker emits Effect's built-in HTTP server spans plus endpoint and database child spans.
Effect's OpenTelemetry exporter stores semantic HTTP attributes below the `attributes.` prefix.
For example:

```apl
['upcomputer-relay-traces-prod']
| where name startswith 'http.server'
| project _time, name, trace_id, duration,
    ['attributes.http.request.method'],
    ['attributes.url.path'],
    ['attributes.http.response.status_code']
| order by _time desc
| limit 200
```

Endpoint failure annotations and other relay-specific attributes are also emitted in the
`attributes.custom` map when present on a span, for example
`['attributes.custom']['relay.endpoint']`.

Agents should prefer the provisioned view or APL queries for completed incidents instead of
tailing the Cloudflare Worker. The stack does not provision a separate query token. Responders who
need scripted query access use the authorized account-level `AXIOM_TOKEN` together with
`AXIOM_ORG_ID`; scoped ingest tokens remain write-only credentials for their producers.

DPoP proof failures include the stable `relay.dpop.failure_code` span attribute. A `time_window`
failure means that a signed proof was too old or too far in the future for the relay's allowed
window. It can point to a date or time problem on either device, but it can also result from a
delayed request. The client uses this category, and the absence of a category from an older relay,
to decide whether clock skew is confirmed or only one possible cause.
