# Product usage data

The Up.computer server sends product usage events to PostHog, associated with a hashed random
identifier for the installation. To count how many installations one person uses, the server also
sends a hashed identifier for your UpComputer Connect account when you are signed in to one, and a
random identifier for each device that connects. Up.computer never reads or sends identifiers
from your provider accounts, such as your OpenAI or Claude account. Events include the
provider, model, reasoning effort, permission mode, turn result and, for a failed turn, a
category of why (such as a usage limit), duration, release channel, and main-agent token totals
when available. They also say whether the agent could connect to Up.computer's tools and how
many of your own MCP servers failed, without their names or addresses. During setup they also
include which welcome steps you reached, which agent you tried to install or sign in to, and
whether each agent CLI is installed (with its version) and signed in. In the app they include
which sections you open (such as Tasks, Workers, or Settings), how long a window stays connected,
which buttons you click, when you first create a task, worker, automation, or scheduled task, and
when an agent first answers. Turn events also say how long the agent took to start answering. A
button is reported by a fixed name from the app's code, never by its text. Every event also says
what kind of build sent it (such as a release or a test build) and carries a random ID that is
new each time the app or server starts, so events from one session can be grouped.

For tasks and workers, events say how each worker run ended (such as completed, blocked, or
failed, with a reason from a fixed list), what started it, which agent CLI ran it, and how long
it took. They say whether an automation, scheduled task, or webhook fired, and why one did not.
When the server starts, they say roughly how many tasks, workers, bots, automations, scheduled
tasks, webhooks, and working agent CLIs you have (as ranges such as "2-4"), and whether remote
access is on. They never include task or worker text, webhook addresses or request contents.

When something goes wrong, events say where an error happened (the server, the app window or
the desktop app), the kind of error from a fixed list of names, the name of the app file it
came from and a fingerprint of the code path. They also say when a server stopped
unexpectedly, when a window crashed, and when the app did not shut down cleanly the last time.
They never include the error message, file paths or what you were working on.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
names or titles of your threads, tasks, projects, or workers, raw provider events, or child-agent
output. Child-agent token use is excluded from the totals.

Up.computer also sends relay connection traces to Axiom to diagnose UpComputer Connect connectivity.
Traces carry connection timings, request paths, environment and thread identifiers, and error
types. They omit machine addresses, query strings, log lines, error messages, and stack frames.

## Turn it off

Turn off **Share anonymous usage data** in **Settings > About**. Product events, error reports and
relay traces stop at once, events waiting to be sent are dropped, and nothing announces the
change. The choice is kept across restarts and updates. Turning it back on resumes with the same
installation identifier.

You can also set `UPCOMPUTER_TELEMETRY_ENABLED=false` (or `T3CODE_TELEMETRY_ENABLED=false`) in the
server's environment before starting it. The desktop app reads it from your shell profile (for
example `~/.zshrc`) on macOS and Linux, so export it there and restart the app. On Windows, set it
as a user environment variable. Relay tracing also stops when `T3CODE_OTEL_SDK_DISABLED` or
`OTEL_SDK_DISABLED` turns OpenTelemetry export off.

An administrator can turn product events and relay tracing off with a
[managed policy](./managed-policy.md#other-capabilities). The variable and the policy win over the
Settings switch, which then shows as off and cannot be changed.

A browser opened from an Up.computer server sends relay traces only while connected and allowed by
that server. The hosted web app sends relay traces when configured.

## Surveys

After you have used Up.computer for a week, on at least three different days, the notifications
button may show a short survey from the Up.computer team. It asks at most once a month, and the
questions come with the app, so nothing is fetched to show it. With product events on, your
answers are sent as you go: the card's answer when you pick it, your answers so far each time
you press **Continue** or **Skip**, and the rest when you press **Send**. With product events
off, nothing is sent until you press **Send**. Then the answers go out alone, under a random
identifier, with nothing about your installation, and Up.computer asks the analytics service
not to keep your IP address or work out your location from it. Close the card to dismiss the
survey; it does not come back. A managed policy that turns usage data off also turns
surveys off.

## Send feedback

To report a bug or share an idea, open the notifications button and choose **Send feedback**
at the bottom, or search for it in the command palette. Only what you write is sent, with two
optional extras: **Include app version and system info** (on by default) adds the app version,
your operating system and the names of your connected providers, and **You can email me about
this** adds your email. Chats, files, paths and tokens are never included. Feedback is sent when
you press **Send**, also with product events off; then it goes out the same way as survey
answers, under a random identifier. Without system info it always goes out that way. With
product events on and system info included, feedback is sent with the same identity as your
other usage data, so an email you add is linked to it too. A managed
policy that turns usage data off also turns feedback off.

## Mark a team or test device

If you work on Up.computer or test it, open **Settings > General > Diagnostics**, select the
environment, and turn on **Internal device** under **Product usage data**. Its events are then
marked as internal, so they can be left out of product numbers. The setting is kept across
updates. Turn it off the same way.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`T3CODE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `T3CODE_OTLP_*_URL`, set `T3CODE_OTLP_HEADERS` for
receivers that need authentication and `T3CODE_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
