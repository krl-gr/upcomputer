# Antigravity

Up.computer runs Google's official Antigravity ACP agent on your selected environment.
It has its own sign-in, separate from the Antigravity IDE or CLI. Google controls
which models and account access are available through this agent.

## Set up Antigravity

Open **Settings > Providers**, choose the environment that runs your project, and
enable Antigravity. Install its runtime there, then choose **Sign in with Google**
and complete the browser sign-in. Wait for Up.computer to confirm account access and
load models before starting a thread. First-run onboarding offers the same install
and sign-in steps.

Installation continues if you leave settings or reconnect.

### Sign in from a remote device

Google returns to a `127.0.0.1` address. It can finish directly when your browser is
on the environment's machine. From another device, the final page will usually
fail to load because the sign-in listener is on the environment.

Copy the full return address, including everything after `?`, into the return URL
field in the client where you started setup, then choose **Continue**. Keep the
original address; do not replace it with the server's hostname. Only that
Up.computer sign-in session can finish the attempt. If it expires, retry sign-in
and use the new link.

The return URL contains a temporary sign-in code. Paste it only into the setup
field. A successful callback page alone does not confirm account access; wait for
Up.computer's confirmation.

### Other sign-in methods

Choose **Sign-in method** in the Antigravity provider settings:

| Method                     | Credentials                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Google account             | Personal Google sign-in in the browser                                                       |
| Gemini Enterprise          | Browser sign-in, GCP project, and GCP location                                               |
| Gemini API key             | API key; choose Connect without a browser                                                    |
| Agent Platform / Vertex AI | API key, or GCP project and location with Application Default Credentials on the environment |

The Antigravity API key field is stored in plain text in settings on the
environment. The agent uses the method and credentials selected for this instance;
ambient `GEMINI_API_KEY` and Google credential variables do not override them.
Changing the method stops the instance's sessions. Sign out before replacing an
account.

## Runtime installation

Managed installation supports Apple Silicon macOS, Linux x64 or ARM64, and Windows
x64 or ARM64. Intel Macs can connect to a supported remote environment. Allow
several GB of free disk space, especially on Linux.

Up.computer downloads the release pinned in the app from Google's servers and
checks its size and SHA-256 before anything is unpacked. The runtime is installed
under `~/.upcomputer/tools/antigravity-acp`, outside the app, and each Antigravity
instance keeps its Google sign-in in its own profile under `~/.upcomputer/userdata`.

### Use a manual installation

Download the archive for your environment from the [official ACP Registry][registry].
Extract the ACP executable and its `localharness_external` helper into the same
directory, at the same version. Make both executable on macOS or Linux; Windows
uses `.exe` files.

Set **Binary path** to the ACP executable on the environment and update it yourself.
Leave the field blank to use the managed runtime, or a compatible executable on
`PATH` if no managed runtime is installed.

## Models and threads

The model list comes from your Antigravity account and can differ from other
Antigravity apps. A resumed thread keeps its selected model. If access to that
model ends, select another available model before continuing.

Use Antigravity's native `/plan` command for planning. Up.computer's separate Plan
mode is unavailable. Questions with fixed choices still need one of the offered
answers, even in **Full access**.

Up.computer keeps conversation history and file diffs, but Antigravity cannot rewind
its conversation. Reverting a thread or editing and resubmitting an earlier turn
is unavailable. Continue with a follow-up message or start a new thread.

### Skills and attachments

Put project skills in `.agents/skills`. Up.computer also reads `.gemini/skills` and
the legacy `.agent/skills` directory. Among these project locations, the first copy
wins in this order: `.gemini/skills`, `.agents/skills`, `.agent/skills`.

Skills for every project go in `~/.gemini/config/skills` or
`~/.gemini/antigravity-cli/skills`. Antigravity does not read `~/.agents/skills`,
so a skill there only appears when the project itself is your home directory.

Antigravity accepts BMP, JPEG, PNG, and WebP images, up to 10 MiB each and 50 MiB
per message. Other image formats are rejected.

### Subagents

Antigravity groups subagent activity into batches. You cannot open or control
individual subagents. A batch shows as finished when its turn ends, which does not
confirm that every child succeeded.

## Accounts and removal

Add an Antigravity provider instance for each Google account in
**Settings > Providers**. Each has its own sign-in; downloaded runtimes are shared
on the environment.

| Action                    | Effect                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| Disable                   | Stops the instance's sessions and keeps its Google sign-in.       |
| Sign out of Google        | Stops the instance's sessions and removes its saved Google login. |
| Remove downloaded runtime | Removes the shared installation and keeps Google credentials.     |

All three keep thread history and workspace files. Sending `/logout` by itself in
a thread signs out its instance, including stopping that instance's other sessions.
Sign out, then sign in again to replace an account.

Before removing a managed runtime, disable its instances and cancel any active
installation. Clear any explicit binary path pointing into that runtime. Removal
is refused while the runtime is in use.

## Check access and troubleshoot

A server restart keeps your Google sign-in. The provider shows the saved account
until a session, a refresh, or a sign-out reports something new.

To check access and reload models, use **Refresh provider status** in provider
settings. If asked to sign in again, use setup in provider settings.

If Google reports `SUBSCRIPTION_REQUIRED`, an account restriction, or a usage limit,
follow the provider's message and any retry time. See [Google's account plans][plans]
for eligibility.

[registry]: https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json
[plans]: https://antigravity.google/docs/plans
