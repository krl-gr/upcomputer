# Welcome page

The Welcome page shows what Up.computer found on a computer, on one page: your
agents and projects from your Claude Code, Codex, and Pi history. Only an agent
is needed to start chatting.

To open the page, go to **Settings → About → Welcome page** and select **Open**,
or select **Connect another agent** in the composer while your first agent sets up.
Direct links, such as Settings, open normally before setup is done.

## First launch of the desktop app

The Up.computer desktop app skips the Welcome page on a new installation and opens
straight into a chat. While it sets up your first agent, the composer shows
**Setting up your agent…**. The app downloads OpenCode by itself, about 50 MB,
with no terminal and no account. New threads use OpenCode's automatic model, a free
OpenCode Zen model, which moves to another free model by itself if that one stops
being free. A model you choose in **Settings → General** stays chosen.
If OpenCode 1.14.19 or newer is already installed, the app uses it and
downloads nothing. If an agent you already use, such as Claude or Codex, is
installed and signed in, the app keeps it for new threads and downloads nothing.

If the download fails, for example without a network connection, the composer says
why. Select **Retry**, or **Connect another agent** to set up Codex, Claude or
another agent on the Welcome page instead.

## Hosted app

The hosted app at app.up.computer does not open the page. With no computer connected,
it asks you to sign in to UpComputer Connect, then to install Up.computer and run
`up connect` on your computer. From home, it adds compatible computers linked to your account and
opens the app. To add more computers later, use **Settings → Environments**.

If Up.computer cannot confirm the workspace during startup, it shows
**Still connecting** instead of opening the app. Select **Reload** to try again.

If Up.computer cannot read your saved settings, it shows **Could not read settings**.
Select **Retry** after storage becomes available. Setup does not replace
unreadable settings with defaults.

## Agents

Up.computer lists the agents it found on the computer first, ready ones on top.
**Add more agents** lists every other agent Up.computer supports, A to Z. When no agent
is found, it reads **Set up an agent** and opens by itself:

- **Turn on** enables an agent that is off on this computer, including one only
  some projects use. Up.computer then checks whether it is installed and signed in.
- For Claude Code, **Install** or **Sign in** opens a terminal with the correct
  command ready to run. Install uses the vendor's own installer, which keeps
  **Update now** working in Settings.
- For Codex, **Set up** offers sign-in with your ChatGPT account or your own
  Codex CLI. **Use existing CLI** opens the terminal to install or sign in, and
  **Continue with ChatGPT** stays available until Codex is signed in.
- When Up.computer knows an installed version does not work with it, **Update** opens
  the agent in **Settings → Providers**, which shows the version to use and updates it
  when it can.
- Other agents, and agents that could not load, open their page in
  **Settings → Providers**.
- **Browse** opens the ACP Registry for more agents.

On the desktop app, when the folder of the `up` command is not on your `PATH`,
**Add to PATH** adds one line to your shell's startup file.

The setup terminal uses the home directory and environment configured for the
provider instance. Sensitive values remain redacted in Settings and
terminal metadata while the terminal process can use them.

**Start** waits for one ready agent. Select **Start without an agent** to finish
without one. Checked projects are still imported.

## Projects

Up.computer finds directories that Claude Code, Codex or Pi has used. Git repositories
are listed first, newest activity on top. When the remote is on GitHub, the
group shows the repository as `owner/name`. Clones with the same remote share
one group. Directories that are not git repositories sit under "Other folders".

The page offers git repositories active within the last 30 days with at least
three conversations, already checked. Projects already in Up.computer are not checked
again. Uncheck the box to start without them, or
select **Review all** to pick from everything found, with "Select all" and
"Select none". Linked worktrees of bare repositories
can be offered as separate projects. Conversations in other linked git worktrees
count toward their main checkout, so a repository is offered even if you only
worked in its worktrees. Codex scratch directories under `Documents/Codex`, and
anything under `Downloads` are not offered.

A large or malformed history can reach the scan limit. Up.computer keeps the
projects it found and warns when projects or conversations may be missing.

Imported projects include Claude, Codex and Pi conversations active within the last
30 days. You can continue those conversations in Up.computer. Pi is off by default:
open **Add more agents** and select **Turn on** next to Pi, and the page looks for
its sessions too. Pi sessions
are read from each enabled Pi provider's session directory, which follows
`PI_CODING_AGENT_SESSION_DIR` and `PI_CODING_AGENT_DIR` in its environment. A
Pi conversation imports its active branch, the one Pi reopens.

Conversation import is best effort. Up.computer keeps the first user prompt and the
newest remaining visible user and assistant messages, with 200 messages total.
It omits tool activity and attachments. For Codex, it omits generated setup
context only when a canonical user event and a valid shared turn ID identify the
same user turn. Ambiguous legacy or response-only context stays in the imported
conversation so Up.computer does not remove user text. It reads one conversation at
a time and skips files larger than 4 GiB. It also skips a conversation when the
message text and metadata it keeps need more than 32 MiB of memory. Tool output
does not count toward that limit. It skips a conversation with more than 100,000
records every time, so opening the page again does not import it. It ignores
malformed records and skips unreadable or unparseable conversations.

Each import attempt reads up to 100 conversation files and 4 GiB per project. To
continue a large batch, open the Welcome page again and pick the project in
**Review all**. Completed conversations are not imported again. You can continue
without the remaining history.

You can start without importing. While an import runs, Up.computer stays on the
Welcome page. If you quit, open the Welcome page again from **Settings → About**; the
projects you started stay checked.
