# Instruction updates

Up.computer ships text and settings that steer agents: the default task instructions
(`TaskPromptSettings`), the standard task statuses, the Tasks list's default group order and
workflow behavior such as Failed on crashed runs. Users build on them in different ways: the
same status can mean "not approved" to one user and "queued for a worker" to another, and even a
reworded sentence changes what agents do. So no build changes them on an existing install
silently.

## The rule

Every change to that shipped text or those settings is an entry in `INSTRUCTION_UPDATES`
([instructionUpdates.ts](../../packages/tasks-contracts/src/v1/instructionUpdates.ts)). Nobody
judges a change small enough to skip it. Bug fixes and other code changes are not entries.

- Do not write a migration that rewrites stored prompts or statuses, as 015 and 025 to 032 did.
  Those already ran and stay as they are.
- Change the default (`DEFAULT_TASK_PROMPT_SETTINGS`, `TASK_STATUSES`,
  `DEFAULT_STATUS_GROUP_ORDER`, a workflow version) and add an entry in the same change, with
  the before and after data, the why, how a bot looks at the user's setup and the exact steps to
  apply it. Add its translated copy in `instructionUpdateCopy.ts` (tasks-web).
- An entry is a record of what shipped: never edit one after release, and keep its id forever,
  since installs store their decision under it. Entries chain: each "before" is the previous
  "after" and the last "after" is today's default. The registry tests in tasks-contracts and
  tasks-web fail when a default changes without an entry or an old entry still points at a
  constant that moved, so write such texts out literally before changing the constant.
- An entry that needs a step no tool can do needs that tool first: a bot applies updates only
  through task tools, and each write must be revertable the way instructions history is.

## How installs take them

Migration 044 gives every known entry a row: applied on a new install (it was just seeded with
today's defaults), pending otherwise. When the server starts it gives entries a later build added
a row (pending, or applied when the install already runs the entry's workflow). In "Apply
automatically" mode it then applies a pending entry as shipped only when nothing the user wrote
would change: the entry's prompts still hold their "before" (or "after") text, and no worker
instructions, project additions or All chats text name a status the entry renames. Everything
else waits for the user, who applies it with a bot (the brief from `instructionUpdatesBrief`) or
keeps their setup.
