# Import projects from Claude Code and Codex

If you already work with Claude Code or Codex, Up.computer can bring those
projects and their recent conversations in, so you can continue them here.

The import only reads Claude Code and Codex files. It never changes, moves, or
deletes them.

## Where to find it

- **First run.** After you set up your agents, onboarding shows **Import your
  projects**. Choose **Import**, or **Skip** to continue without importing. If
  your agents already work and you have no projects yet, onboarding opens
  directly on this step when there is something to import.
- **Settings.** Open **Settings > General** and choose **Import from Claude
  Code / Codex** under **Import projects**. You can run it at any time, for
  example to add a project later or to pick up newer conversations.

## Choose your projects

Up.computer lists the directories Claude Code or Codex has used on this
computer. Git repositories come first, newest activity on top. When the remote
is on GitHub, the row shows the repository as `owner/name`. Clones with the same
remote share one group. Directories that are not git repositories sit under
**Other folders**.

Each row shows which agent was used there, how many conversations it has, and
when it was last active.

## Automated sessions

By default Up.computer counts and imports only conversations you had
yourself: Claude Code in the terminal or an IDE, and Codex in the terminal,
an IDE, or the Codex app. It leaves out sessions that a script or another app
started:

- Claude Code sessions run through the Agent SDK (`sdk-ts`, `sdk-py`).
- Codex sessions run with `codex exec` or as an MCP server, and subagents that
  a Codex session spawned.
- Sessions Up.computer or T3 Code started. They already live in the app that
  created them, so they are never imported.

This is decided from the origin each transcript records, not from its content.
Transcripts without that information count as your own.

Below the list, a note says how many sessions were left out, for example "849
automated sessions (SDK, exec, Up.computer) skipped". Check **Include automated
sessions** to list and import SDK, `codex exec`, and subagent sessions too.
Up.computer includes Claude Code sessions it ran itself in that group, because
their transcripts look like any other Agent SDK session.

A project whose only sessions are automated stays in the list with no
conversations and no date, and is not selected by default.

The default selection includes every project with your own conversations
within the last 30 days, whether it is a git repository or not. Older projects stay in the list and can
be selected. Use the checkboxes, or **Select all** and **Select none**, to change
the selection. Linked git worktrees, Up.computer's own worktrees, Codex scratch
directories under `Documents/Codex`, and anything under `Downloads` are not
offered.

Projects you already have in Up.computer are listed too. Importing one adds its
new conversations without creating a second project.

## What is imported

Each selected project gets its Claude Code and Codex conversations that were
active within the last 30 days. Imported conversations appear in the sidebar
like any other thread. Send a message in one to continue the same Claude Code or
Codex session.

Conversation import is best effort:

- It keeps the first user prompt and the newest visible user and assistant
  messages, up to 200 messages per conversation.
- It leaves out tool activity and attachments.
- It skips malformed records, and conversations it cannot read or parse.
- It skips conversation files larger than 16 MiB.

## Limits

Each import reads up to 100 conversation files and 64 MiB per project, with up
to 100,000 records. When a project has more, the import says how many
conversations it imported so far, for example "Imported 54 of 867
conversations. Run import again to continue", and stays open with **Continue
import**. Each run continues where the last one stopped: completed
conversations are not imported twice.

A very large or unusual history can also reach the scan limit while listing
projects. Up.computer keeps the projects it found and shows a note that older
sessions were not checked. When some conversations cannot be imported at all,
a warning says how many.
