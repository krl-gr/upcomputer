# Product usage data

The T3 Code server sends product usage events to PostHog, associated with a hashed account or
installation identifier. Events include the provider, model, reasoning effort, permission mode,
turn result and, for a failed turn, a category of why (such as a usage limit), duration, and
main-agent token totals when available. They also say whether the agent could connect to
Up.computer's tools and how many of your own MCP servers failed, without their names or
addresses. During setup they also include
which welcome steps you reached, which agent you tried to install or sign in to, and whether each
agent CLI is installed (with its version) and signed in. In the app they include which sections
you open (such as Tasks, Agents, or Settings), how long a window stays connected, which buttons
you click, when you first create a task, agent, automation, or scheduled task, and when an
agent first answers. Turn events also say how long the agent took to start answering. A button
is reported by a fixed name from the app's code, never by its text. Every event also says what
kind of build sent it (such as a release or a test build) and carries a random ID that is
new each time the app or server starts, so events from one session can be grouped.

For tasks and agents, events say how each agent run ended (such as completed, blocked, or
failed, with a reason from a fixed list), what started it, which agent CLI ran it, and how long
it took. They say whether an automation, scheduled task, or webhook fired, and why one did not.
When the server starts, they say roughly how many tasks, agents, bots, automations, scheduled
tasks, webhooks, and working agent CLIs you have (as ranges such as "2-4"), and whether remote
access is on. They never include task or agent text, webhook addresses or request contents.

When something goes wrong, events say where an error happened (the server, the app window or
the desktop app), the kind of error from a fixed list of names, the name of the app file it
came from and a fingerprint of the code path. They also say when a server stopped
unexpectedly, when a window crashed, and when the app did not shut down cleanly the last time.
They never include the error message, file paths or what you were working on.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
names or titles of your threads, tasks, projects, or agents, raw provider events, or child-agent
output. Child-agent token use is excluded from the totals.

To disable collection, set `T3CODE_TELEMETRY_ENABLED=false` in the server's environment before
starting it. This stops product events from being recorded or sent.

The desktop app reads the variable from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

## Mark a team or test device

If you work on Up.computer or test it, open **Settings > General > Diagnostics**, select the
environment, and turn on **Internal device** under **Product usage data**. Its events are then
marked as internal, so they can be left out of product numbers. The setting is kept across
updates. Turn it off the same way.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > General > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`T3CODE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. For endpoints saved here or set with `T3CODE_OTLP_*_URL`, set `T3CODE_OTLP_HEADERS` for
receivers that need authentication and `T3CODE_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
