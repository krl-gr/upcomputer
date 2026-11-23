import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { LEGACY_TASK_PROMPT_SETTINGS, type TaskPromptField } from "./prompts.ts";
import {
  LEGACY_TASK_STATUSES,
  TASK_STATUSES,
  TaskId,
  TaskTag,
  TaskWorkflowVersion,
} from "./tasks.ts";

/*
 * Instruction updates: every change to the shipped text and settings that steer
 * agents ships as an entry below, which each install applies or keeps, never
 * silently. Rules for adding one: docs/internals/instruction-updates.md.
 */

/** One piece of shipped text or settings an entry changes, with both versions. */
export type InstructionUpdateChange =
  | {
      readonly kind: "statuses";
      readonly before: ReadonlyArray<string>;
      readonly after: ReadonlyArray<string>;
    }
  | {
      /** The Tasks list's default group order. */
      readonly kind: "groupOrder";
      readonly before: ReadonlyArray<string>;
      readonly after: ReadonlyArray<string>;
    }
  | {
      readonly kind: "prompt";
      readonly field: TaskPromptField;
      readonly before: string;
      readonly after: string;
    }
  | {
      readonly kind: "failedOnCrash";
      readonly before: boolean;
      readonly after: boolean;
    };

export interface InstructionUpdateEntry {
  /** Stable forever: installs store their decision under it. */
  readonly id: string;
  /** The app version that introduced it. */
  readonly release: string;
  readonly title: string;
  /** Names the brief file a chat gets for this entry alone. */
  readonly briefName: string;
  /** One line under the title. */
  readonly summary: string;
  readonly why: string;
  readonly changes: ReadonlyArray<InstructionUpdateChange>;
  /**
   * Old status to new one, as the update means them. Applying automatically
   * renames these on tasks, worker start statuses, automation templates and the
   * saved group order; a bot asks the user what each one means to them first.
   */
  readonly statusRenames?: Readonly<Record<string, string>>;
  /** The workflow version applying the entry moves the install to. */
  readonly workflowVersion?: TaskWorkflowVersion;
  /** How a bot looks at this user's setup before it proposes anything. */
  readonly look: ReadonlyArray<string>;
  /** The exact steps a bot follows once the user agrees. */
  readonly apply: ReadonlyArray<string>;
}

/**
 * Every entry, oldest first. Their before and after texts chain: an entry's
 * "before" is the previous entry's "after", and the last "after" is today's
 * default (instructionUpdates.test.ts checks it). Never edit a shipped entry's
 * changes: write the texts out literally before changing a default they name.
 */
export const INSTRUCTION_UPDATES: ReadonlyArray<InstructionUpdateEntry> = [
  {
    id: "task-statuses-v2",
    release: "0.0.40",
    title: "We updated how task statuses work",
    briefName: "Task statuses update",
    summary: "New statuses, a new group order, and default instructions to match.",
    why: "Some status names could be read two ways. Backlog meant an idea for one person and a queued task for another, and Needs Input and Needs Review did not say what was needed from you. The new names say who acts next. A task whose worker run crashes now moves to Failed instead of staying in progress.",
    changes: [
      { kind: "statuses", before: LEGACY_TASK_STATUSES, after: TASK_STATUSES },
      {
        kind: "groupOrder",
        before: [
          "Needs Input",
          "Needs Review",
          "In Review",
          "In Progress",
          "To Do",
          "Backlog",
          "Blocked",
          "Idea",
          "Done",
          "Cancelled",
        ],
        after: [
          "Needs You",
          "Failed",
          "Blocked",
          "In Review",
          "In Progress",
          "To Do",
          "Queued",
          "To Verify",
          "Idea",
          "Done",
          "Cancelled",
        ],
      },
      {
        kind: "prompt",
        field: "taskCreation",
        before: LEGACY_TASK_PROMPT_SETTINGS.taskCreation,
        after: `Create focused, independently reviewable tasks. The description must be self-contained and keep the user's intent: goal, context, target, constraints, verification and expected output, so the agent never needs the originating chat. Include absolute paths of attached images and tell the agent to open them.

Choosing the agent: unless the user's recorded preferences or explicit words already decide it, do not pick one silently. Show the relevant agents from task_context's agents (name, model, start statuses and tags), recommend one with a reason, and let the user decide. If none fits, propose creating one; agent_search also lists disabled agents.

Assignment: add the chosen agent's trigger tag and record its id in metadata.targetAgentId. A run id exists only after the run starts.

Queue: an agent works through its tasks one at a time. task_context's agents shows each agent's queue, so no task_search or agent_get is needed before creating. If the agent has no task in its start status, none In Progress and none active, create the first task directly in its start status so it starts now, and any further ones in Queued. Otherwise create them all in Queued; the agent's queue hand-off activates them later. Use Idea only for ideas the user has not approved yet. Create several tasks in one task_create call (tasks), in the order they should run: new tasks go to the top of the list and queues run from the bottom, so they run in the order given and no reorder is needed. An agent without start statuses starts on its tag in any status, so add the tag only when the task should start. Never start several tasks of one queue at once unless the user asked for fan-out.`,
      },
      {
        kind: "prompt",
        field: "agentCreation",
        before: LEGACY_TASK_PROMPT_SETTINGS.agentCreation,
        after: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default. Recommend strong models for orchestration and review, and fast or cheap ones for bulk work. Offer only providers and models that task_context reports as available; never assume one is installed.

Adapt these templates for the agent's instructions.

Queue worker (developer), started by its tag in its start status, e.g. To Do:
- Work only on tasks with your tag in your start status.
- At start: set In Progress and read the repository's AGENTS.md or CLAUDE.md. The run prompt carries the task, its output and its recent events, and the run already holds it, so do not call task_get at the start.
- Make the smallest coherent change; verify it with tests, typecheck and lint.
- Commit only your own files, and only if the user allowed commits.
- Run every command in the foreground with a timeout; start no background processes.
- Keep the task output current.
- Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the bottom Queued task with your tag to your start status: task_search with your tag, status Queued, from "bottom" and limit 1 returns it. Never more than one.
- Final mutation: a single task_update to the review status, e.g. To Verify, with assigneeAgentRunId: null. When a person must decide something first, the same update with status Needs You and the question at the top of the output. When blocked, status Blocked and the blocker in the output.

Reviewer, started by its own tag or status:
- Read the full diff and run the verification yourself.
- Never edit; report findings by severity with file:line and evidence.
- End with one task_update that hands the task to a person: To Verify, your trigger tag removed, and assigneeAgentRunId: null.`,
      },
      {
        kind: "prompt",
        field: "taskExecution",
        before: LEGACY_TASK_PROMPT_SETTINGS.taskExecution,
        after: `Your agent's own instructions come first; where they differ from this, follow them.
- Start from this prompt: it carries the task, its output, its recent events and whether your run already holds the task. Do not call task_get at the start; call it only right before changing the task, when another run may have changed it.
- Keep the task status and output current, so a person can evaluate the result without reading the thread.
- Run every command in the foreground and wait for it; start no background processes.
- Record blockers with evidence. On quota, rate-limit or auth failures, stop and report them; do not retry.
- If your instructions define a queue hand-off, do it before the final update.
- Do everything else first, then make exactly one final task_update with assigneeAgentRunId: null. It ends the run. When the work is finished, give that update the status To Verify so a person checks it. When a person must decide something first, give it Needs You with the question at the top of the output. If you cannot continue, give it the status Blocked and the blocker in the output; the run then ends as blocked.`,
      },
      { kind: "failedOnCrash", before: false, after: true },
    ],
    statusRenames: { Backlog: "Queued", "Needs Input": "Needs You", "Needs Review": "To Verify" },
    workflowVersion: 2,
    look: [
      "Call instruction_updates_get. It shows this install's workflow version, the saved status group order and open groups, and which of the texts above the user edited (editedFields).",
      'Count the tasks in each old status: task_search with status "Backlog", then "Needs Input", then "Needs Review", each with audience "all", archive "all" and limit 50. Read some titles in each to learn what the status means to this user. Above all, check whether Backlog holds approved work waiting for a worker (Queued fits) or ideas nobody approved yet (Idea fits). It can hold both.',
      "List the workers with agent_search: their start statuses, and instructions that name Backlog, Needs Input or Needs Review, such as a queue hand-off from Backlog or a final status Needs Review.",
      'Read the instructions with instructions_get: the global texts with allChats, and each project\'s additions (task_context with include ["projects"] lists the projects, then instructions_get with that projectId). Note where they name the old statuses.',
      "List the automations with automation_search: a task template can create tasks in an old status.",
    ],
    apply: [
      'Rename the statuses on tasks with task_status_rename, one call per old status, for example from "Needs Input" to "Needs You", using the meaning the user agreed to. If Backlog holds both kinds of tasks, rename the queued ones to Queued by ids and the rest to Idea. Pass automationTemplates: true so automations create tasks in the new status. A rename starts no worker. Keep the ids it returns: renaming those tasks back undoes it.',
      "Update each worker's start statuses and instructions with agent_update, replacing the old names as agreed. Show the user the changed lines first when the instructions are long.",
      "For each of taskCreation, agentCreation and taskExecution: if editedFields does not list it, offer the After text above as it is. If the user edited it, change only the status names and the sentences about them, and keep the rest of their text. Save with instructions_update. Do the same for allChats and each project's additions where they name the old statuses.",
      'If the saved statusGroupOrder is not empty, the user ordered the groups themselves: rewrite its keys with task_list_settings_update so renamed groups keep their places ("backlog" to "queued", "needs input" to "needs you", "needs review" to "to verify") and add "failed" near the top. Carry the statusGroupOpen keys over the same way. An empty order follows the default and needs nothing.',
      "Last, switch the workflow with task_workflow_version_set and version 2. It changes no task or text by itself: the Tasks list, the status pickers and Restore default then use the new statuses and texts, and a task whose run crashes moves to Failed.",
    ],
  },
  {
    id: "bot-vs-worker-agent-creation",
    release: "0.0.40",
    title: "Agent creation guidance now explains bots vs. workers",
    briefName: "Bot vs worker guidance update",
    summary: "Tells agents when to create a bot instead of a background worker.",
    why: "Agents can now create and edit bots with bot_create and bot_update. Without this note in the agent creation guidance, a chat asked to make a bot could still create a background worker with agent_create instead.",
    changes: [
      {
        kind: "prompt",
        field: "agentCreation",
        before: `Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default. Recommend strong models for orchestration and review, and fast or cheap ones for bulk work. Offer only providers and models that task_context reports as available; never assume one is installed.

Adapt these templates for the agent's instructions.

Queue worker (developer), started by its tag in its start status, e.g. To Do:
- Work only on tasks with your tag in your start status.
- At start: set In Progress and read the repository's AGENTS.md or CLAUDE.md. The run prompt carries the task, its output and its recent events, and the run already holds it, so do not call task_get at the start.
- Make the smallest coherent change; verify it with tests, typecheck and lint.
- Commit only your own files, and only if the user allowed commits.
- Run every command in the foreground with a timeout; start no background processes.
- Keep the task output current.
- Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the bottom Queued task with your tag to your start status: task_search with your tag, status Queued, from "bottom" and limit 1 returns it. Never more than one.
- Final mutation: a single task_update to the review status, e.g. To Verify, with assigneeAgentRunId: null. When a person must decide something first, the same update with status Needs You and the question at the top of the output. When blocked, status Blocked and the blocker in the output.

Reviewer, started by its own tag or status:
- Read the full diff and run the verification yourself.
- Never edit; report findings by severity with file:line and evidence.
- End with one task_update that hands the task to a person: To Verify, your trigger tag removed, and assigneeAgentRunId: null.`,
        after: `Bot or worker: a bot has one permanent chat, its own memory and a place under Bots; create it with bot_create. A worker has no chat: it picks up tasks by its start statuses and tags and is listed under Workers; create it with agent_create. When the user asks for a bot, use bot_create.

Create narrowly scoped agents with a clear role, explicit responsibilities, and trigger statuses or tags that do not overlap accidentally. Choose and explicitly pass a model appropriate for the work the agent will perform, along with appropriate runtime permissions. Project, current-thread, and server defaults are contextual fallbacks, not suitability recommendations; use modelAlias: "project" only when deliberately choosing the project default. Recommend strong models for orchestration and review, and fast or cheap ones for bulk work. Offer only providers and models that task_context reports as available; never assume one is installed.

Adapt these templates for the agent's instructions.

Queue worker (developer), started by its tag in its start status, e.g. To Do:
- Work only on tasks with your tag in your start status.
- At start: set In Progress and read the repository's AGENTS.md or CLAUDE.md. The run prompt carries the task, its output and its recent events, and the run already holds it, so do not call task_get at the start.
- Make the smallest coherent change; verify it with tests, typecheck and lint.
- Commit only your own files, and only if the user allowed commits.
- Run every command in the foreground with a timeout; start no background processes.
- Keep the task output current.
- Queue hand-off, before the final update: if no other task with your tag is in your start status or In Progress, move the bottom Queued task with your tag to your start status: task_search with your tag, status Queued, from "bottom" and limit 1 returns it. Never more than one.
- Final mutation: a single task_update to the review status, e.g. To Verify, with assigneeAgentRunId: null. When a person must decide something first, the same update with status Needs You and the question at the top of the output. When blocked, status Blocked and the blocker in the output.

Reviewer, started by its own tag or status:
- Read the full diff and run the verification yourself.
- Never edit; report findings by severity with file:line and evidence.
- End with one task_update that hands the task to a person: To Verify, your trigger tag removed, and assigneeAgentRunId: null.`,
      },
    ],
    look: [
      "Call instruction_updates_get to see whether the user edited agentCreation (editedFields).",
      "Call instructions_get to read the current global agentCreation text.",
    ],
    apply: [
      "If editedFields does not list agentCreation, save the After text above with instructions_update. If the user edited agentCreation, add the opening Bot or worker paragraph at the top and keep the rest of their text.",
    ],
  },
];

export function instructionUpdateById(id: string): InstructionUpdateEntry | undefined {
  return INSTRUCTION_UPDATES.find((entry) => entry.id === id);
}

/**
 * An install's decision on one entry. `dismissed` is still pending: the user
 * hid its notification, and it waits in Settings. `kept` closed it without
 * applying it ("Keep mine").
 */
export const InstructionUpdateState = Schema.Literals(["pending", "dismissed", "applied", "kept"]);
export type InstructionUpdateState = typeof InstructionUpdateState.Type;

export const isPendingInstructionUpdate = (state: InstructionUpdateState) =>
  state === "pending" || state === "dismissed";

/** "Ask me" (the default) or "Apply automatically" when nothing the user edited would change. */
export const InstructionUpdatesMode = Schema.Literals(["ask", "auto"]);
export type InstructionUpdatesMode = typeof InstructionUpdatesMode.Type;

/** Who closed an entry: the server by itself, a person in Settings, or a chat with a bot or agent. */
export const InstructionUpdateDecider = Schema.Struct({
  kind: Schema.Literals(["auto", "person", "chat"]),
  /** The bot's name for a bot chat. */
  name: Schema.NullOr(Schema.String),
});
export type InstructionUpdateDecider = typeof InstructionUpdateDecider.Type;

export const InstructionUpdateStatus = Schema.Struct({
  id: TrimmedNonEmptyString,
  state: InstructionUpdateState,
  decidedAt: Schema.NullOr(IsoDateTime),
  decidedBy: Schema.NullOr(InstructionUpdateDecider),
  /** Applying it would change text the user edited, so it never applies by itself. */
  touchesEditedText: Schema.Boolean,
});
export type InstructionUpdateStatus = typeof InstructionUpdateStatus.Type;

/** One install's entries, oldest first. Entries this server does not know are left out. */
export const InstructionUpdates = Schema.Struct({
  mode: InstructionUpdatesMode,
  entries: Schema.Array(InstructionUpdateStatus),
});
export type InstructionUpdates = typeof InstructionUpdates.Type;

export const InstructionUpdatesGetInput = Schema.Struct({});
export type InstructionUpdatesGetInput = typeof InstructionUpdatesGetInput.Type;

/**
 * The Settings and bell writes. A person dismisses, keeps or reopens an entry;
 * applying it is a bot's or the server's job, so `applied` is not offered.
 */
export const InstructionUpdatesUpdateInput = Schema.Struct({
  mode: Schema.optional(InstructionUpdatesMode),
  entries: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: TrimmedNonEmptyString,
        state: Schema.Literals(["pending", "dismissed", "kept"]),
      }),
    ).check(Schema.isMaxLength(100)),
  ),
});
export type InstructionUpdatesUpdateInput = typeof InstructionUpdatesUpdateInput.Type;

/** instruction_updates_get: every entry, and with `id` that entry's brief. */
export const InstructionUpdatesToolGetInput = Schema.Struct({
  id: Schema.optional(TrimmedNonEmptyString),
});
export type InstructionUpdatesToolGetInput = typeof InstructionUpdatesToolGetInput.Type;

export const InstructionUpdateDecideInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  state: Schema.Literals(["applied", "kept", "pending"]),
});
export type InstructionUpdateDecideInput = typeof InstructionUpdateDecideInput.Type;

export const TASK_STATUS_RENAME_IDS_LIMIT = 5_000;

/** task_status_rename: one status to another on many tasks in one call. */
export const TaskStatusRenameInput = Schema.Struct({
  from: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
  ids: Schema.optional(
    Schema.Array(TaskId).check(Schema.isMaxLength(TASK_STATUS_RENAME_IDS_LIMIT)),
  ),
  projectId: Schema.optional(ProjectId),
  tags: Schema.optional(Schema.Array(TaskTag)),
  automationTemplates: Schema.optional(Schema.Boolean),
});
export type TaskStatusRenameInput = typeof TaskStatusRenameInput.Type;

export const TaskWorkflowVersionSetInput = Schema.Struct({ version: TaskWorkflowVersion });
export type TaskWorkflowVersionSetInput = typeof TaskWorkflowVersionSetInput.Type;

const PROMPT_FIELD_LABEL: Record<TaskPromptField, string> = {
  taskCreation: "Task creation instructions (taskCreation)",
  agentCreation: "Worker creation instructions (agentCreation)",
  automationCreation: "Automation creation instructions (automationCreation)",
  taskExecution: "Task execution instructions (taskExecution)",
};

function changeSection(change: InstructionUpdateChange, entry: InstructionUpdateEntry): string[] {
  const block = (text: string) => ["````text", text, "````"];
  switch (change.kind) {
    case "statuses": {
      const renames = Object.entries(entry.statusRenames ?? {});
      const added = change.after.filter(
        (status) =>
          !change.before.includes(status) && !renames.some(([, renamed]) => renamed === status),
      );
      return [
        "### Task statuses",
        "",
        `Before: ${change.before.join(", ")}`,
        "",
        `After: ${change.after.join(", ")}`,
        "",
        ...(renames.length > 0
          ? [
              "Renamed, as the update means them (ask the user what each old name means to them):",
              "",
              ...renames.map(([from, to]) => `- ${from} -> ${to}`),
              "",
            ]
          : []),
        ...(added.length > 0 ? [`New: ${added.join(", ")}`, ""] : []),
        "Statuses are free text: nothing renames a task's status by itself.",
      ];
    }
    case "groupOrder":
      return [
        "### Status group order (Tasks list)",
        "",
        `Before: ${change.before.join(", ")}`,
        "",
        `After: ${change.after.join(", ")}`,
        "",
        "Groups follow this order unless the user saved their own (statusGroupOrder).",
      ];
    case "prompt":
      return [
        `### ${PROMPT_FIELD_LABEL[change.field]}`,
        "",
        "Before:",
        "",
        ...block(change.before),
        "",
        "After:",
        "",
        ...block(change.after),
      ];
    case "failedOnCrash":
      return [
        "### Failed on crashed runs",
        "",
        `Before: ${change.before ? "on" : "off"}. After: ${change.after ? "on" : "off"}.`,
        "",
        "When on, a task whose worker run fails or is interrupted while it holds the task moves to Failed. Continuing the run moves it back to In Progress. It follows the workflow version.",
      ];
  }
}

function entrySection(entry: InstructionUpdateEntry): string {
  return [
    `# ${entry.title}`,
    "",
    `Entry id: \`${entry.id}\`. Up.computer ${entry.release}.`,
    "",
    "## Why",
    "",
    entry.why,
    "",
    "## What changed",
    "",
    ...entry.changes.flatMap((change) => [...changeSection(change, entry), ""]),
    "## Look first",
    "",
    ...entry.look.map((step) => `- ${step}`),
    "",
    "## Apply, after the user agrees",
    "",
    ...entry.apply.map((step, index) => `${index + 1}. ${step}`),
    `${entry.apply.length + 1}. Call instruction_update_decide with id "${entry.id}" and state "applied", also when you applied it adapted to this user. If the user keeps their setup, call it with state "kept" instead, and change nothing else.`,
  ].join("\n");
}

/**
 * The brief a chat gets as an attached file: how to work, then for each entry
 * what changed and why, both texts, how to look at the user's setup and the
 * exact steps to apply it.
 */
export function instructionUpdatesBrief(entries: ReadonlyArray<InstructionUpdateEntry>): string {
  const many = entries.length > 1;
  return [
    many ? "# Instruction updates" : "# Instruction update",
    "",
    `A new version of Up.computer changed defaults that steer this user's agents: ${entries.map((entry) => `"${entry.title}"`).join(", ")}. This install still runs the old ones. The user asked you to help decide how to apply ${many ? "these updates" : "this update"}.`,
    "",
    "## How to work",
    "",
    "1. Change nothing until the user agrees. Read and look first, then propose.",
    '2. Look at how this user works today, as each update\'s "Look first" says. People use statuses and instructions differently: the same name can mean different things to two people.',
    "3. Tell the user in a few lines what changed, what it would mean for their tasks, workers and instructions, and what you suggest, including what you would keep as it is. Ask about anything that depends on what a status means to them.",
    '4. Apply only what they agreed to, with the steps under "Apply". Each step can be undone: instructions_revert undoes an instructions change, and task_status_rename with the returned ids renames tasks back.',
    "5. Finish each update with instruction_update_decide: applied or kept. If the user wants to decide later, leave it pending.",
    "",
    entries.map(entrySection).join("\n\n---\n\n"),
    "",
  ].join("\n");
}

/** The attached file's name. */
export function instructionUpdatesBriefName(
  entries: ReadonlyArray<InstructionUpdateEntry>,
): string {
  const [only] = entries;
  return entries.length === 1 && only
    ? `${only.briefName}.md`
    : `${entries.length} instruction updates.md`;
}
