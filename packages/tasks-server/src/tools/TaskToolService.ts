import {
  AgentCreateInput,
  AgentDeleteInput,
  AgentGetInput,
  AgentRunGetInput,
  AgentRunMessageInput,
  AgentRunSearchInput,
  AgentRunStopInput,
  AgentRunTranscriptInput,
  AgentSearchInput,
  AgentUpdateInput,
  AUTOMATION_DRAFT_LIMIT_PER_PROJECT,
  AutomationCreateInput,
  AutomationDeleteInput,
  AutomationGetInput,
  AutomationSearchInput,
  AutomationUpdateInput,
  DEFAULT_AUTOMATION_CATCH_UP_POLICY,
  DEFAULT_AUTOMATION_TIMEZONE,
  InstructionsGetInput,
  InstructionsHistoryInput,
  InstructionsRevertInput,
  InstructionsUpdateInput,
  INSTRUCTIONS_FIELDS,
  TASK_PROMPT_FIELDS,
  TaskAppendEventInput,
  TaskArchiveInput,
  TaskDeleteInput,
  TaskEventId,
  TaskGetInput,
  TaskId,
  TaskAgentId,
  TaskAgentRunId,
  TaskAutomationId,
  TaskReorderInput,
  TaskScheduleAddInput,
  TaskScheduleDeleteInput,
  TaskScheduleMoveInput,
  TaskScheduleToolGetInput,
  TaskScheduleUpdateInput,
  TaskSearchInput,
  TASK_CREATE_BATCH_LIMIT,
  TaskToolContextInput,
  TaskToolCreateBatchInput,
  TaskToolCreateInput,
  TaskToolCreateItem,
  TaskUpdateInput,
  type Task,
  type TaskActor,
  type TaskAgent,
  type TaskAgentRun,
  type TaskAudience,
  type TaskAutomation,
  type InstructionsField,
  type TaskPromptSettingsChange,
  personTaskStatusError,
  taskKindAudienceError,
} from "@t3tools/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  CUSTOM_INSTRUCTIONS_MAX_CHARS,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  type ModelSelection,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";

import {
  ProjectStoreV2,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import type { TaskToolInvocationContext } from "./TaskToolTypes.ts";

import { agentRunModes, broaderRunMode, type RunModes } from "../agents/runModes.ts";
import {
  noMatchingAgentReason,
  releasedRunId,
  startsForTask,
  TaskAgentService,
} from "../agents/TaskAgentService.ts";
import { parseAutomationCron } from "../automations/automationSchedule.ts";
import { automationToolWriteRefusal } from "../automations/automationToolPolicy.ts";
import { normalizeAutomationTemplate } from "../automations/automationWrites.ts";
import { projectAgentQueues } from "../context/AgentQueues.ts";
import {
  compactTaskToolContext,
  TaskToolContextResolver,
} from "../context/TaskToolContextResolver.ts";
import { InboxProject } from "../inbox/InboxProject.ts";
import { BotService } from "../bots/BotService.ts";
import { TaskScheduleService } from "../schedule/TaskScheduleService.ts";
import { TaskRepository, type PersistTaskInput } from "../persistence/TaskRepository.ts";
import {
  composeTaskPromptSettings,
  TaskPromptSettingsStore,
  type TaskPromptChangeOrigin,
} from "../persistence/TaskPromptSettingsStore.ts";
import {
  PROMPT_GUIDANCE_EDITING,
  PROMPT_GUIDANCE_SCHEDULING,
  TASK_TRIGGER_RULES,
} from "./TaskToolDefinitions.ts";
import { TaskToolService, type TaskToolServiceShape } from "./TaskToolServiceTag.ts";
import { setTasksArchived } from "../taskArchive.ts";
import { makeFirstUseRecorder } from "../telemetry/firstUse.ts";

export { TaskToolService } from "./TaskToolServiceTag.ts";
export type { TaskToolServiceShape } from "./TaskToolServiceTag.ts";

const decoders = {
  task_context: Schema.decodeUnknownEffect(TaskToolContextInput),
  task_get: Schema.decodeUnknownEffect(TaskGetInput),
  task_search: Schema.decodeUnknownEffect(TaskSearchInput),
  task_create: Schema.decodeUnknownEffect(TaskToolCreateInput),
  task_create_batch: Schema.decodeUnknownEffect(TaskToolCreateBatchInput),
  task_create_item: Schema.decodeUnknownEffect(TaskToolCreateItem),
  task_update: Schema.decodeUnknownEffect(TaskUpdateInput),
  task_reorder: Schema.decodeUnknownEffect(TaskReorderInput),
  task_delete: Schema.decodeUnknownEffect(TaskDeleteInput),
  task_event_append: Schema.decodeUnknownEffect(TaskAppendEventInput),
  task_archive: Schema.decodeUnknownEffect(TaskArchiveInput),
  task_unarchive: Schema.decodeUnknownEffect(TaskArchiveInput),
  task_schedule_get: Schema.decodeUnknownEffect(TaskScheduleToolGetInput),
  task_schedule_add: Schema.decodeUnknownEffect(TaskScheduleAddInput),
  task_schedule_update: Schema.decodeUnknownEffect(TaskScheduleUpdateInput),
  task_schedule_move: Schema.decodeUnknownEffect(TaskScheduleMoveInput),
  task_schedule_delete: Schema.decodeUnknownEffect(TaskScheduleDeleteInput),
  agent_get: Schema.decodeUnknownEffect(AgentGetInput),
  agent_search: Schema.decodeUnknownEffect(AgentSearchInput),
  agent_create: Schema.decodeUnknownEffect(AgentCreateInput),
  agent_update: Schema.decodeUnknownEffect(AgentUpdateInput),
  agent_delete: Schema.decodeUnknownEffect(AgentDeleteInput),
  agent_run_get: Schema.decodeUnknownEffect(AgentRunGetInput),
  agent_run_search: Schema.decodeUnknownEffect(AgentRunSearchInput),
  agent_run_transcript: Schema.decodeUnknownEffect(AgentRunTranscriptInput),
  agent_run_stop: Schema.decodeUnknownEffect(AgentRunStopInput),
  agent_run_message: Schema.decodeUnknownEffect(AgentRunMessageInput),
  automation_get: Schema.decodeUnknownEffect(AutomationGetInput),
  automation_search: Schema.decodeUnknownEffect(AutomationSearchInput),
  automation_create: Schema.decodeUnknownEffect(AutomationCreateInput),
  automation_update: Schema.decodeUnknownEffect(AutomationUpdateInput),
  automation_delete: Schema.decodeUnknownEffect(AutomationDeleteInput),
  instructions_get: Schema.decodeUnknownEffect(InstructionsGetInput),
  instructions_update: Schema.decodeUnknownEffect(InstructionsUpdateInput),
  instructions_history: Schema.decodeUnknownEffect(InstructionsHistoryInput),
  instructions_revert: Schema.decodeUnknownEffect(InstructionsRevertInput),
} as const;

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * A dry run looks like success to a model, which then tells the person the
 * task exists. Say plainly that nothing was saved, and why.
 */
function withDryRunNotice(
  result: { readonly isError: boolean; readonly text: string },
  context: TaskToolInvocationContext,
): { readonly isError: boolean; readonly text: string } {
  if (result.isError) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return result;
  }
  if (typeof parsed !== "object" || parsed === null || !("dryRun" in parsed)) return result;
  const notice =
    context.interactionMode === "plan"
      ? "Plan mode: nothing was saved. Switch the chat out of Plan mode to create or change tasks."
      : "Nothing was saved: this caller can only read tasks. Ask in an Up.computer chat to make changes.";
  return { ...result, text: json({ notice, ...parsed }) };
}

const TRANSCRIPT_ENTRY_MAX_CHARS = 4_000;

function truncateText(text: string, limit: number): string {
  return text.length > limit
    ? `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`
    : text;
}

type TranscriptEntry =
  | {
      readonly type: "message";
      readonly role: string;
      readonly text: string;
      readonly createdAt: string;
    }
  | {
      readonly type: "activity";
      readonly kind: string;
      readonly summary: string;
      readonly createdAt: string;
    };

/** The v2 thread records a transcript reads. */
type TranscriptThread = Pick<OrchestrationV2ThreadProjection, "messages" | "turnItems" | "runs">;

function buildAgentRunTranscript(
  run: TaskAgentRun,
  thread: TranscriptThread,
  input: typeof AgentRunTranscriptInput.Type,
) {
  const iso = (value: DateTime.DateTime) => DateTime.formatIso(DateTime.toUtc(value));
  const entries: TranscriptEntry[] = [
    ...thread.messages.map((message) => ({
      type: "message" as const,
      role: message.role,
      text: message.text,
      createdAt: iso(message.createdAt),
    })),
    // Tool calls, approvals and other turn items stand in for V1 activities.
    ...(input.includeActivities === false
      ? []
      : thread.turnItems
          .filter((item) => item.type !== "user_message" && item.type !== "assistant_message")
          .map((item) => ({
            type: "activity" as const,
            kind: item.type,
            summary: item.title ?? item.type,
            createdAt: iso(item.startedAt ?? item.updatedAt),
          }))),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  // Walk newest first so the character budget keeps the most recent entries.
  let budget = input.maxChars ?? 20_000;
  const kept: TranscriptEntry[] = [];
  for (const entry of entries.slice(-(input.tail ?? 40)).toReversed()) {
    if (budget <= 0) break;
    const limit = Math.min(TRANSCRIPT_ENTRY_MAX_CHARS, budget);
    const truncated =
      entry.type === "message"
        ? { ...entry, text: truncateText(entry.text, limit) }
        : { ...entry, summary: truncateText(entry.summary, limit) };
    budget -= truncated.type === "message" ? truncated.text.length : truncated.summary.length;
    kept.unshift(truncated);
  }
  return {
    run,
    failureReason: thread.runs.some((v2Run) => v2Run.status === "failed")
      ? (thread.turnItems
          .flatMap((item) =>
            item.type === "error" && item.status === "failed" && item.parentItemId === null
              ? [item.failure.message]
              : [],
          )
          .at(-1) ?? "A run on this thread failed; see the transcript entries.")
      : null,
    olderEntriesOmitted: kept.length < entries.length,
    entries: kept,
  };
}

const INSTRUCTION_FIELD_USE: Record<InstructionsField, string> = {
  allChats:
    "Settings → Instructions → All chats (the core customInstructions setting). Part of the prompt of every chat and every task-agent run, in every harness.",
  taskCreation: "Returned by task_context; guidance for task_create.",
  agentCreation: "Returned by task_context; guidance for agent_create and agent_update.",
  automationCreation: "Returned by task_context; guidance for automation_create.",
  taskExecution: "Part of the prompt of every task-agent run.",
};

const PROJECT_FIELD_NOTE =
  "This project's text is added after the global text, under a heading, for tasks in this project.";

const ALL_CHATS_IS_GLOBAL =
  "allChats is global: every chat gets it, and a project has no allChats text. Leave out projectId to read or edit it.";

/** Above this, allChats or taskExecution noticeably grows every prompt they are part of. */
const EVERY_PROMPT_LARGE_CHARS = 2_000;
const CHANGE_EXCERPT_MAX_CHARS = 600;

/** The edited span between the common prefix and suffix, enough for a one-line report. */
function describeInstructionsChange(field: InstructionsField, previous: string, next: string) {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix += 1;
  const removed = previous.slice(prefix, previous.length - suffix);
  const added = next.slice(prefix, next.length - suffix);
  return {
    field,
    previousLength: previous.length,
    newLength: next.length,
    removed: truncateText(removed, CHANGE_EXCERPT_MAX_CHARS),
    added: truncateText(added, CHANGE_EXCERPT_MAX_CHARS),
    ...((field === "taskExecution" || field === "allChats") &&
    next.length > EVERY_PROMPT_LARGE_CHARS
      ? {
          warning: `${field} is now ${next.length} characters and is part of ${field === "allChats" ? "every chat's and every task-agent run's" : "every task-agent run's"} prompt. Tell the user it is getting large.`,
        }
      : {}),
  };
}

function instructionsChangeView(change: TaskPromptSettingsChange) {
  return {
    changeId: change.id,
    ...(change.projectId === null ? {} : { projectId: change.projectId }),
    revision: change.revision,
    field: change.field,
    previousText: change.previousText,
    newText: change.newText,
    reason: change.reason,
    source:
      change.source === "settings-page"
        ? "settings page"
        : change.source === "mcp"
          ? "MCP client"
          : change.source,
    threadId: change.threadId,
    runId: change.runId,
    revertsChangeId: change.revertsChangeId,
    createdAt: change.createdAt,
  };
}

function dryRun(context: TaskToolInvocationContext): boolean {
  // The host resolves the active interaction mode and supplies its effective
  // safety policy. Missing policy fails closed for older or unknown callers.
  return context.mutationPolicy !== "allow";
}

/**
 * Why the caller may not start or continue a run in these modes, or null. The
 * ceiling core puts on a thread sending to another thread (`resolveRuntimeMode`
 * in OrchestratorMcpService): the calling thread's run must be live, and the
 * run it starts may not have a broader runtime or interaction mode than the
 * caller's own. People acting in the app are not limited.
 */
function runStartRefusal(
  context: TaskToolInvocationContext,
  target: RunModes,
  action: string,
): string | null {
  const byPerson = "A person can do this in the Tasks view.";
  const ceiling = callerRunModes(context);
  if (ceiling === null) {
    return `${action} needs an active run in the calling thread. ${byPerson}`;
  }
  switch (broaderRunMode(target, ceiling)) {
    case "runtimeMode":
      return `${action} would run in ${target.runtimeMode} mode, broader than this thread's ${ceiling.runtimeMode} mode. ${byPerson}`;
    case "interactionMode":
      return `${action} would run in ${target.interactionMode} interaction mode, broader than this thread's ${ceiling.interactionMode} mode. ${byPerson}`;
    case null:
      return null;
  }
}

/** The modes of the caller's live run: the most a run it starts may use. Null when not live. */
function callerRunModes(context: TaskToolInvocationContext): RunModes | null {
  if (context.live !== true || context.runtimeMode === undefined) return null;
  return {
    runtimeMode: context.runtimeMode,
    interactionMode: context.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
  };
}

/** Who a tool call acts as in task history: the calling task-agent run, else the calling thread. */
function toolActor(context: TaskToolInvocationContext, callerRun: TaskAgentRun | null): TaskActor {
  if (callerRun !== null) return { type: "agent-run", agentRunId: callerRun.id };
  return context.threadId ? { type: "thread", threadId: context.threadId } : { type: "server" };
}

/** A task task_create stores: the item's fields in the resolved project, from the calling thread. */
function newTask(
  item: TaskToolCreateItem,
  input: {
    readonly id: TaskId;
    readonly projectId: PersistTaskInput["projectId"];
    readonly timestamp: string;
    readonly context: TaskToolInvocationContext;
  },
): PersistTaskInput {
  const threadId = input.context.threadId ?? null;
  return {
    id: input.id,
    projectId: input.projectId,
    title: item.title,
    description: item.description,
    output: item.output ?? null,
    status: item.status,
    priority: item.priority ?? null,
    createdBy: item.createdBy ?? "agent",
    assigneeAgentRunId: item.assigneeAgentRunId ?? null,
    originThreadId: threadId,
    sourceThreadId: item.sourceThreadId === undefined ? threadId : item.sourceThreadId,
    sourceRunId: item.sourceRunId ?? null,
    metadata: item.metadata ?? null,
    tags: item.tags ?? [],
    notBefore: item.notBefore ?? null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    archivedAt: null,
    audience: item.audience,
    ...(item.kind !== undefined ? { kind: item.kind } : {}),
  };
}

/**
 * task_create refuses a task without an audience before decoding, with this
 * instead of a schema error: the agent must decide whose task it is.
 */
const AUDIENCE_REQUIRED =
  'audience is required: person when the user does the task themselves (they asked for it as theirs: "for me", "my task", "I\'ll do it", "remind me"), agent when an agent does it. A routine is always person.';

const lacksAudience = (raw: unknown) =>
  typeof raw === "object" && raw !== null && (raw as { audience?: unknown }).audience === undefined;

/** Where task_create's tasks show, so a caller sees at once whose task it made. */
const SHOWN_IN: Record<TaskAudience, string> = {
  person:
    "Person task: shown in the user's planner (Me), not in the agents' table. No agent starts on it by status.",
  agent:
    "Agent task: shown in the agents' table (Agents), not in the user's planner. Agents start on it by their triggers.",
};

/** The top-level task_create arguments that go with a tasks list. */
const TASK_CREATE_BATCH_KEYS = new Set(["tasks", "projectId", "workspaceRoot"]);

function patchTask(existing: Task, update: typeof TaskUpdateInput.Type, updatedAt: string): Task {
  return {
    ...existing,
    ...(update.projectId !== undefined ? { projectId: update.projectId } : {}),
    ...(update.audience !== undefined ? { audience: update.audience } : {}),
    ...(update.kind !== undefined ? { kind: update.kind } : {}),
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.description !== undefined ? { description: update.description } : {}),
    ...(update.output !== undefined ? { output: update.output } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.priority !== undefined ? { priority: update.priority } : {}),
    ...(update.assigneeAgentRunId !== undefined
      ? { assigneeAgentRunId: update.assigneeAgentRunId }
      : {}),
    ...(update.sourceThreadId !== undefined ? { sourceThreadId: update.sourceThreadId } : {}),
    ...(update.sourceRunId !== undefined ? { sourceRunId: update.sourceRunId } : {}),
    ...(update.metadata !== undefined ? { metadata: update.metadata } : {}),
    ...(update.tags !== undefined ? { tags: update.tags } : {}),
    ...(update.notBefore !== undefined ? { notBefore: update.notBefore } : {}),
    updatedAt,
  };
}

export type AgentCreateModelDecision =
  | { readonly ok: true; readonly modelSelection: ModelSelection }
  | { readonly ok: false; readonly reason: "missing-explicit-selection" | "unresolved-selection" };

function resolveAgentCreateModelDecision(
  input: typeof AgentCreateInput.Type,
  resolvedModel: ModelSelection | undefined,
): AgentCreateModelDecision {
  const explicitModelSelection = input.modelSelection ?? input.config?.modelSelection;
  if (explicitModelSelection) return { ok: true, modelSelection: explicitModelSelection };
  if (input.modelAlias === undefined) return { ok: false, reason: "missing-explicit-selection" };
  return resolvedModel
    ? { ok: true, modelSelection: resolvedModel }
    : { ok: false, reason: "unresolved-selection" };
}

/** Undefined when the given modelAlias did not resolve: keeping the old model would hide that. */
function resolveAgentUpdateModelSelection(
  input: typeof AgentUpdateInput.Type,
  existing: ModelSelection,
  resolvedModel: ModelSelection | undefined,
): ModelSelection | undefined {
  const explicit = input.modelSelection ?? input.config?.modelSelection;
  if (explicit) return explicit;
  return input.modelAlias !== undefined ? resolvedModel : existing;
}

function hasAgentConfigPatch(input: typeof AgentCreateInput.Type | typeof AgentUpdateInput.Type) {
  return (
    input.config !== undefined ||
    input.modelSelection !== undefined ||
    input.modelAlias !== undefined ||
    input.role !== undefined ||
    input.runtimeMode !== undefined ||
    input.interactionMode !== undefined ||
    input.tools !== undefined ||
    input.skills !== undefined ||
    input.instructions !== undefined
  );
}

function buildAgentConfig(input: {
  readonly name: string;
  readonly existing?: TaskAgent["config"];
  readonly modelSelection: TaskAgent["config"]["modelSelection"];
  readonly patch: typeof AgentCreateInput.Type | typeof AgentUpdateInput.Type;
}): TaskAgent["config"] {
  const base = input.patch.config ?? input.existing;
  const runtimeMode = input.patch.runtimeMode ?? base?.runtimeMode;
  const interactionMode = input.patch.interactionMode ?? base?.interactionMode;
  const tools = input.patch.tools ?? base?.tools;
  const skills = input.patch.skills ?? base?.skills;
  return {
    role: input.patch.role ?? base?.role ?? input.name,
    modelSelection: input.modelSelection,
    instructions:
      input.patch.instructions ??
      base?.instructions ??
      `Run tasks assigned to the "${input.name}" agent. Update task status and append an outcome note.`,
    ...(runtimeMode !== undefined ? { runtimeMode } : {}),
    ...(interactionMode !== undefined ? { interactionMode } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(skills !== undefined ? { skills } : {}),
  };
}

const make = Effect.gen(function* () {
  const repository = yield* TaskRepository;
  const promptSettings = yield* TaskPromptSettingsStore;
  const resolver = yield* TaskToolContextResolver;
  const taskAgents = yield* TaskAgentService;
  const projects = yield* ProjectStoreV2;
  const threads = yield* ThreadManagementService;
  const inbox = yield* InboxProject;
  const schedule = yield* TaskScheduleService;
  const bots = yield* BotService;
  const crypto = yield* Crypto.Crypto;
  const recordFirstUse = yield* makeFirstUseRecorder;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const randomId = (prefix: string) =>
    crypto.randomUUIDv4().pipe(Effect.map((uuid) => `${prefix}-${uuid}`));
  /**
   * Task-agent runs read untrusted content, so an injected "add to the
   * instructions" must not rewrite every agent's rules. A thread that any run
   * used stays a run thread after the run ends: it writes only when the agent
   * of its latest run lists the tool. Chats and the loopback MCP bridge may
   * write. This guards against accidental or injected writes; it is not a
   * security boundary, since a run with shell access can edit the settings
   * files directly.
   */
  const instructionsWriteAccess = (name: string, context: TaskToolInvocationContext) =>
    Effect.gen(function* () {
      const run = context.threadId
        ? yield* repository.findLatestAgentRunByThreadId({ threadId: context.threadId })
        : Option.none<TaskAgentRun>();
      const origin: TaskPromptChangeOrigin = {
        source: context.threadId ? "thread" : context.source === "mcp" ? "mcp" : "unknown",
        threadId: context.threadId ?? null,
        runId: Option.isSome(run) ? run.value.id : null,
      };
      if (Option.isNone(run)) return { origin, refusal: null };
      const agent = yield* repository.getAgentById({ id: run.value.agentId });
      const allowed = Option.isSome(agent) && (agent.value.config.tools ?? []).includes(name);
      return {
        origin,
        refusal: allowed
          ? null
          : `Task-agent run '${run.value.id}' cannot change the shared task instructions: they apply to every agent, and a run may be acting on untrusted content. This also applies after the run ended. Put the suggested change in your task output instead. A person can allow this agent by adding '${name}' to its tools. This guards against accidental or injected writes; it is not a security boundary.`,
      };
    });

  /**
   * The project an instructions tool targets: null for the global texts. A
   * deleted project's texts are kept but cannot be read or edited here.
   */
  const instructionsProject = (projectId: string | undefined) =>
    projectId === undefined
      ? Effect.succeed({ project: null, error: null })
      : projects.getShell(ProjectId.make(projectId)).pipe(
          Effect.orElseSucceed(() => Option.none()),
          Effect.map((project) =>
            Option.isSome(project)
              ? { project: { id: project.value.id, title: project.value.title }, error: null }
              : {
                  project: null,
                  error: `Project '${projectId}' was not found. Use task_context with include ["projects"] to list projects.`,
                },
          ),
        );

  /**
   * Archived tasks an agent may not unarchive, with the reason: unarchiving
   * would start an enabled agent that this caller may not start (see
   * `runStartRefusal`). Checked as if notBefore had passed, since a postponed
   * task starts its agents later without asking again. Outside a dry run it
   * runs inside the unarchive's transaction (see `setTasksArchived`).
   */
  const unarchiveRefusals = (ids: ReadonlyArray<TaskId>, context: TaskToolInvocationContext) =>
    Effect.gen(function* () {
      const refusals = new Map<TaskId, string>();
      const agents = (yield* repository.listAllAgents()).filter((agent) => agent.enabled);
      if (agents.length === 0) return refusals;
      for (const id of new Set(ids)) {
        const task = Option.getOrNull(yield* repository.getById({ id }));
        if (task === null || task.archivedAt === null) continue;
        for (const agent of agents) {
          if (!startsForTask(agent, { ...task, archivedAt: null }, Number.POSITIVE_INFINITY))
            continue;
          const refusal = runStartRefusal(
            context,
            agentRunModes(agent.config),
            `Unarchiving it starts agent '${agent.name}' (${agent.id}), which`,
          );
          if (refusal !== null) {
            refusals.set(id, refusal);
            break;
          }
        }
      }
      return refusals;
    });

  /**
   * task_create with a tasks list. Every item is checked before anything is
   * written, then all tasks are stored in one transaction in list order, so
   * each goes to the top above the one before it: the first ends lowest, and
   * a queue, which runs from the bottom, takes them in list order. Agents
   * are scheduled per task after the commit, as for single creates.
   */
  const createTasks = (args: Record<string, unknown>, context: TaskToolInvocationContext) =>
    Effect.gen(function* () {
      const input = yield* decoders.task_create_batch(args);
      const misplaced = Object.keys(args).filter((key) => !TASK_CREATE_BATCH_KEYS.has(key));
      if (misplaced.length > 0)
        return {
          isError: true,
          text: `With tasks, every task's fields go inside its item. Move ${misplaced.join(", ")} into the items. No task was created.`,
        };
      if (input.tasks.length === 0 || input.tasks.length > TASK_CREATE_BATCH_LIMIT)
        return {
          isError: true,
          text: `tasks takes 1 to ${TASK_CREATE_BATCH_LIMIT} tasks; got ${input.tasks.length}. No task was created.`,
        };
      const items: TaskToolCreateItem[] = [];
      for (const [index, raw] of input.tasks.entries()) {
        const title =
          typeof raw === "object" && raw !== null && "title" in raw ? raw.title : undefined;
        const named = `tasks[${index}]${typeof title === "string" ? ` (${JSON.stringify(title)})` : ""}`;
        if (lacksAudience(raw))
          return {
            isError: true,
            text: `${named} is invalid: ${AUDIENCE_REQUIRED}\nNo task was created.`,
          };
        const item = yield* Effect.result(decoders.task_create_item(raw));
        if (Result.isFailure(item))
          return {
            isError: true,
            text: `${named} is invalid: ${item.failure.message}\nNo task was created.`,
          };
        const invalid =
          taskKindAudienceError(item.success.kind ?? "task", item.success.audience) ??
          personTaskStatusError(item.success.audience, item.success.status);
        if (invalid !== null)
          return {
            isError: true,
            text: `${named} is invalid: ${invalid}\nNo task was created.`,
          };
        items.push(item.success);
      }
      const ids = items.flatMap((item) => (item.id === undefined ? [] : [item.id]));
      const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
      if (repeated !== undefined)
        return {
          isError: true,
          text: `Task id '${repeated}' appears more than once in tasks. No task was created.`,
        };
      const resolution = yield* resolver.resolve({
        args: {
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
        },
        invocationContext: context,
      });
      // Person tasks without a project go to the Inbox, as in the planner.
      if (!resolution.resolvedProject && items.some((item) => item.audience !== "person"))
        return {
          isError: true,
          text: json({
            error:
              "Couldn't tell which project this belongs to, so no task was created. Name the project, or start from a chat inside it.",
            resolution,
          }),
        };
      if (!resolution.resolvedProject && dryRun(context))
        return { isError: false, text: json({ dryRun: true, project: "Inbox", tasks: items }) };
      const projectId = resolution.resolvedProject
        ? resolution.resolvedProject.project.id
        : yield* inbox.ensure;
      const timestamp = yield* now;
      const tasks: PersistTaskInput[] = [];
      for (const item of items)
        tasks.push(
          newTask(item, {
            id: item.id ?? TaskId.make(yield* randomId("task")),
            projectId,
            timestamp,
            context,
          }),
        );
      if (dryRun(context))
        return {
          isError: false,
          text: json({ dryRun: true, tasks, resolution: compactTaskToolContext(resolution) }),
        };
      const callerRun = context.threadId
        ? Option.getOrNull(
            yield* repository.findActiveAgentRunByThreadId({ threadId: context.threadId }),
          )
        : null;
      const actor = toolActor(context, callerRun);
      const saved = yield* repository.withChangeTransaction(
        Effect.forEach(tasks, (task) => repository.upsert({ ...task, actor })),
      );
      for (const task of saved) yield* taskAgents.scheduleTaskChanged({ task, reason: "created" });
      yield* recordFirstUse("app.first_task_created", { via: "agent" });
      // The caller wrote the descriptions; echoing them back would only cost tokens.
      const audiences = [...new Set(saved.map(({ audience }) => audience))];
      return {
        isError: false,
        text: json({
          shownIn: Object.fromEntries(audiences.map((audience) => [audience, SHOWN_IN[audience]])),
          tasks: saved.map(({ id, rank, title, status, audience, tags, notBefore }) => ({
            id,
            rank,
            title,
            status,
            audience,
            tags,
            notBefore,
          })),
        }),
      };
    });

  const call: TaskToolServiceShape["call"] = ({ name, args, context }) =>
    Effect.gen(function* () {
      const isDryRun = dryRun(context);
      switch (name) {
        case "task_context": {
          const input = yield* decoders.task_context(args);
          const include = input.include ?? [];
          const resolution = yield* resolver.resolve({ args: input, invocationContext: context });
          // The task's target project, which may differ from the chat's.
          const project = resolution.resolvedProject?.project;
          const guidance = composeTaskPromptSettings(
            yield* promptSettings.get,
            project === undefined
              ? null
              : {
                  title: project.title,
                  settings: (yield* promptSettings.getProject(project.id)).settings,
                },
          );
          return {
            isError: false,
            text: json({
              ...compactTaskToolContext(resolution, include),
              ...(project === undefined ? {} : yield* projectAgentQueues(repository, project.id)),
              // Creating tasks is the common case; the other texts come on request.
              promptGuidance: {
                taskCreation: guidance.taskCreation,
                ...(include.includes("agentCreation")
                  ? { agentCreation: guidance.agentCreation, taskExecution: guidance.taskExecution }
                  : {}),
                ...(include.includes("automationCreation")
                  ? { automationCreation: guidance.automationCreation }
                  : {}),
              },
              promptGuidanceEditing: PROMPT_GUIDANCE_EDITING,
              promptGuidanceScheduling: PROMPT_GUIDANCE_SCHEDULING,
              triggerRules: TASK_TRIGGER_RULES,
            }),
          };
        }
        case "task_get": {
          const input = yield* decoders.task_get(args);
          const task = yield* repository.getById(input);
          return Option.isSome(task)
            ? { isError: false, text: json({ task: task.value }) }
            : { isError: true, text: `Task '${input.id}' was not found.` };
        }
        case "task_search": {
          const input = yield* decoders.task_search(args);
          // Agents look for their own queue: person tasks only when asked for.
          // Routines are person tasks, so asking for them searches every audience.
          const audience =
            input.audience ?? (input.kind === undefined || input.kind === "task" ? "agent" : "all");
          return {
            isError: false,
            text: json({ tasks: yield* repository.search({ ...input, audience }) }),
          };
        }
        case "task_create": {
          if (args.tasks !== undefined) return yield* createTasks(args, context);
          if (lacksAudience(args))
            return { isError: true, text: `${AUDIENCE_REQUIRED} No task was created.` };
          const input = yield* decoders.task_create(args);
          const invalid =
            taskKindAudienceError(input.kind ?? "task", input.audience) ??
            personTaskStatusError(input.audience, input.status);
          if (invalid !== null) return { isError: true, text: `${invalid} No task was created.` };
          const resolution = yield* resolver.resolve({
            args: {
              ...(input.projectId ? { projectId: input.projectId } : {}),
              ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            },
            invocationContext: context,
          });
          if (!resolution.resolvedProject) {
            // A person task without a project goes to the Inbox, as in the planner.
            if (input.audience !== "person")
              return {
                isError: true,
                text: json({
                  error:
                    "Couldn't tell which project this belongs to. Name the project, or start from a chat inside it.",
                  resolution,
                }),
              };
            if (isDryRun)
              return { isError: false, text: json({ dryRun: true, project: "Inbox", input }) };
          }
          const task = newTask(input, {
            id: input.id ?? TaskId.make(yield* randomId("task")),
            projectId: resolution.resolvedProject
              ? resolution.resolvedProject.project.id
              : yield* inbox.ensure,
            timestamp: yield* now,
            context,
          });
          if (isDryRun)
            return {
              isError: false,
              text: json({ dryRun: true, task, resolution: compactTaskToolContext(resolution) }),
            };
          // An existing id updates that task; a status change is the caller's.
          const callerRun = context.threadId
            ? Option.getOrNull(
                yield* repository.findActiveAgentRunByThreadId({ threadId: context.threadId }),
              )
            : null;
          const saved = yield* repository.upsert({ ...task, actor: toolActor(context, callerRun) });
          yield* taskAgents.scheduleTaskChanged({ task: saved, reason: "created" });
          yield* recordFirstUse("app.first_task_created", { via: "agent" });
          const waiting = noMatchingAgentReason(
            yield* repository.listAllAgents(),
            saved,
            Date.parse(yield* now),
          );
          return {
            isError: false,
            text: json({
              audience: saved.audience,
              shownIn: SHOWN_IN[saved.audience],
              ...(waiting === null ? {} : { warning: waiting }),
              task: saved,
            }),
          };
        }
        case "task_update": {
          const input = yield* decoders.task_update(args);
          if (isDryRun) {
            const existing = yield* repository.getById({ id: input.id });
            return Option.isSome(existing)
              ? {
                  isError: false,
                  text: json({ dryRun: true, task: patchTask(existing.value, input, yield* now) }),
                }
              : { isError: true, text: `Task '${input.id}' was not found.` };
          }
          const before = yield* repository.getById({ id: input.id });
          if (Option.isSome(before)) {
            // A status set with the update must suit the audience it ends with;
            // a task handed to a person without one reopens (see upsert).
            const invalid =
              taskKindAudienceError(
                input.kind ?? before.value.kind,
                input.audience ?? before.value.audience,
              ) ??
              (input.status !== undefined
                ? personTaskStatusError(input.audience ?? before.value.audience, input.status)
                : null);
            if (invalid !== null)
              return { isError: true, text: `${invalid} The task was not changed.` };
          }
          const callerRun = context.threadId
            ? Option.getOrNull(
                yield* repository.findActiveAgentRunByThreadId({ threadId: context.threadId }),
              )
            : null;
          // A run a person's message continued was told only the earlier runs'
          // ids of its thread; claiming with one of them claims for itself.
          const requestedRun =
            callerRun !== null &&
            input.assigneeAgentRunId != null &&
            input.assigneeAgentRunId !== callerRun.id
              ? Option.getOrNull(
                  yield* repository.getAgentRunById({
                    id: TaskAgentRunId.make(input.assigneeAgentRunId),
                  }),
                )
              : null;
          const update =
            callerRun !== null && requestedRun?.threadId === callerRun.threadId
              ? { ...input, assigneeAgentRunId: callerRun.id }
              : input;
          const task = yield* repository.update({
            ...update,
            actor: toolActor(context, callerRun),
          });
          yield* taskAgents.scheduleTaskChanged({
            task,
            reason: "updated",
            releasedRunId: Option.isSome(before)
              ? releasedRunId({
                  before: before.value,
                  after: task,
                  requestedAssignee: update.assigneeAgentRunId,
                  callerRun,
                })
              : null,
          });
          return { isError: false, text: json({ task }) };
        }
        case "task_reorder": {
          const input = yield* decoders.task_reorder(args);
          if (isDryRun) {
            const existing = yield* repository.getById({ id: input.id });
            return Option.isSome(existing)
              ? {
                  isError: false,
                  text: json({ dryRun: true, task: existing.value, reorder: input }),
                }
              : { isError: true, text: `Task '${input.id}' was not found.` };
          }
          return { isError: false, text: json({ task: yield* repository.reorder(input) }) };
        }
        case "task_delete": {
          const input = yield* decoders.task_delete(args);
          const existing = yield* repository.getById(input);
          if (Option.isNone(existing))
            return { isError: true, text: `Task '${input.id}' was not found.` };
          if (isDryRun)
            return {
              isError: false,
              text: json({ dryRun: true, deleted: true, task: existing.value }),
            };
          yield* repository.deleteTask(input);
          yield* taskAgents.scheduleTaskChanged({ task: existing.value, reason: "deleted" });
          return { isError: false, text: json({ deleted: true, id: input.id }) };
        }
        case "task_event_append": {
          const input = yield* decoders.task_event_append(args);
          const event = {
            id: input.id ?? TaskEventId.make(yield* randomId("task-event")),
            taskId: input.taskId,
            kind: input.kind,
            payload: input.payload ?? null,
            createdAt: yield* now,
          };
          return isDryRun
            ? { isError: false, text: json({ dryRun: true, event }) }
            : { isError: false, text: json({ event: yield* repository.appendEvent(event) }) };
        }
        case "task_archive":
        case "task_unarchive": {
          const input = yield* name === "task_archive"
            ? decoders.task_archive(args)
            : decoders.task_unarchive(args);
          const archived = name === "task_archive";
          if (isDryRun) {
            const refusals = archived
              ? new Map<TaskId, string>()
              : yield* unarchiveRefusals(input.ids, context);
            const results = [];
            for (const id of input.ids) {
              const refusal = refusals.get(id);
              if (refusal !== undefined) {
                results.push({ id, outcome: "refused", reason: refusal });
                continue;
              }
              const task = Option.getOrNull(yield* repository.getById({ id }));
              results.push({
                id,
                outcome:
                  task === null
                    ? "not-found"
                    : (task.archivedAt !== null) === archived
                      ? archived
                        ? "already-archived"
                        : "not-archived"
                      : archived
                        ? "archived"
                        : "unarchived",
              });
            }
            return { isError: false, text: json({ dryRun: true, results }) };
          }
          const callerRun = context.threadId
            ? Option.getOrNull(
                yield* repository.findActiveAgentRunByThreadId({ threadId: context.threadId }),
              )
            : null;
          const changed = yield* setTasksArchived(
            { repository, agents: taskAgents },
            {
              ids: input.ids,
              archived,
              reason: input.reason,
              actor: toolActor(context, callerRun),
              ...(archived
                ? {}
                : {
                    startCeiling: callerRunModes(context),
                    refusals: (ids: ReadonlyArray<TaskId>) => unarchiveRefusals(ids, context),
                  }),
            },
          );
          return { isError: false, text: json(changed) };
        }
        case "task_schedule_get": {
          const input = yield* decoders.task_schedule_get(args);
          if (input.taskId !== undefined) {
            if (input.from !== undefined || input.to !== undefined)
              return { isError: true, text: "Pass either taskId or from and to, not both." };
            return {
              isError: false,
              text: json(
                yield* schedule.forTask({
                  taskId: input.taskId,
                  ...(input.limit !== undefined ? { limit: input.limit } : {}),
                  ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
                }),
              ),
            };
          }
          if (input.from === undefined || input.to === undefined)
            return { isError: true, text: "Pass from and to, or taskId." };
          const range = yield* schedule.range({ from: input.from, to: input.to });
          return {
            isError: false,
            // The tasks' identity and state only: their descriptions are for task_get.
            text: json({
              entries: range.entries,
              tasks: range.tasks.map(
                ({ id, title, status, audience, projectId, tags, archivedAt }) => ({
                  id,
                  title,
                  status,
                  audience,
                  projectId,
                  tags,
                  archivedAt,
                }),
              ),
            }),
          };
        }
        // Schedule writes are not gated by run like the instructions: scheduling
        // for the user is work a task may ask for. Read-only modes dry-run them.
        case "task_schedule_add": {
          const input = yield* decoders.task_schedule_add(args);
          if (isDryRun) return { isError: false, text: json({ dryRun: true, input }) };
          return { isError: false, text: json(yield* schedule.add(input)) };
        }
        case "task_schedule_update": {
          const input = yield* decoders.task_schedule_update(args);
          if (isDryRun) return { isError: false, text: json({ dryRun: true, input }) };
          return { isError: false, text: json(yield* schedule.update(input)) };
        }
        case "task_schedule_move": {
          const input = yield* decoders.task_schedule_move(args);
          if (isDryRun) return { isError: false, text: json({ dryRun: true, input }) };
          return { isError: false, text: json(yield* schedule.move(input)) };
        }
        case "task_schedule_delete": {
          const input = yield* decoders.task_schedule_delete(args);
          if (isDryRun) return { isError: false, text: json({ dryRun: true, input }) };
          return {
            isError: false,
            text: json({ deleted: (yield* schedule.remove(input)).entries }),
          };
        }
        case "agent_get": {
          const input = yield* decoders.agent_get(args);
          const agent = yield* repository.getAgentById(input);
          return Option.isSome(agent)
            ? { isError: false, text: json({ agent: agent.value }) }
            : { isError: true, text: `Agent '${input.id}' was not found.` };
        }
        case "agent_search": {
          return {
            isError: false,
            text: json({
              agents: yield* repository.searchAgents(yield* decoders.agent_search(args)),
            }),
          };
        }
        case "agent_create": {
          const input = yield* decoders.agent_create(args);
          const explicitProject = Object.prototype.hasOwnProperty.call(input, "projectId");
          const explicitModelSelection = input.modelSelection ?? input.config?.modelSelection;
          const resolution = yield* resolver.resolve({
            args: {
              ...(input.projectId ? { projectId: input.projectId } : {}),
              ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
              ...(explicitModelSelection ? { modelSelection: explicitModelSelection } : {}),
              ...(input.modelAlias ? { modelAlias: input.modelAlias } : {}),
            },
            invocationContext: context,
          });
          const modelDecision = resolveAgentCreateModelDecision(
            input,
            resolution.resolvedModel?.modelSelection,
          );
          if (!modelDecision.ok) {
            return {
              isError: true,
              text: json({
                error:
                  modelDecision.reason === "missing-explicit-selection"
                    ? "Agent creation requires an explicit model decision. Pass modelSelection, config.modelSelection, or modelAlias (use modelAlias: 'project' to intentionally select the project default)."
                    : "Unable to resolve the explicit agent model selection or alias.",
                resolution,
              }),
            };
          }
          const projectId = explicitProject
            ? (input.projectId ?? null)
            : resolution.resolvedProject?.project.id;
          if (projectId === undefined) {
            return {
              isError: true,
              text: json({
                error:
                  "Couldn't tell which project this agent belongs to. Name the project, or start from a chat inside it.",
                resolution,
              }),
            };
          }
          const model = modelDecision.modelSelection;
          const timestamp = yield* now;
          const agent: TaskAgent = {
            id: input.id ?? TaskAgentId.make(yield* randomId("task-agent")),
            projectId,
            name: input.name,
            enabled: input.enabled ?? true,
            startStatuses: input.startStatuses ?? [],
            startTags: input.startTags ?? [],
            startRunStatuses: input.startRunStatuses ?? [],
            config: buildAgentConfig({ name: input.name, modelSelection: model, patch: input }),
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          if (isDryRun)
            return {
              isError: false,
              text: json({ dryRun: true, agent, resolution: compactTaskToolContext(resolution) }),
            };
          // An enabled agent starts runs on every matching task right away.
          const createRefusal = agent.enabled
            ? runStartRefusal(context, agentRunModes(agent.config), "Creating an enabled agent")
            : null;
          if (createRefusal !== null) return { isError: true, text: createRefusal };
          const saved = yield* repository.upsertAgent(agent);
          yield* taskAgents.scheduleAgentChanged({ agent: saved, reason: "upserted" });
          yield* recordFirstUse("app.first_agent_created", { via: "agent" });
          return {
            isError: false,
            text: json({ agent: saved, resolution: compactTaskToolContext(resolution) }),
          };
        }
        case "agent_update": {
          const input = yield* decoders.agent_update(args);
          const existing = yield* repository.getAgentById({ id: input.id });
          if (Option.isNone(existing))
            return { isError: true, text: `Agent '${input.id}' was not found.` };
          const explicitProject = Object.prototype.hasOwnProperty.call(input, "projectId");
          const needsResolution =
            input.workspaceRoot !== undefined ||
            input.modelSelection !== undefined ||
            input.modelAlias !== undefined ||
            (explicitProject && input.projectId !== null);
          const resolution = needsResolution
            ? yield* resolver.resolve({
                args: {
                  ...(input.projectId ? { projectId: input.projectId } : {}),
                  ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
                  ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
                  ...(input.modelAlias ? { modelAlias: input.modelAlias } : {}),
                },
                invocationContext: context,
              })
            : null;
          const projectId = explicitProject
            ? (input.projectId ?? null)
            : input.workspaceRoot
              ? resolution?.resolvedProject?.project.id
              : existing.value.projectId;
          if (projectId === undefined)
            return {
              isError: true,
              text: json({
                error:
                  "Couldn't tell which project this agent belongs to. Name the project, or start from a chat inside it.",
                resolution,
              }),
            };
          const name = input.name ?? existing.value.name;
          const model = resolveAgentUpdateModelSelection(
            input,
            existing.value.config.modelSelection,
            resolution?.resolvedModel?.modelSelection,
          );
          if (model === undefined)
            return {
              isError: true,
              text: json({
                error: "Unable to resolve the explicit agent model selection or alias.",
                resolution,
              }),
            };
          const agent: TaskAgent = {
            ...existing.value,
            projectId,
            name,
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.startStatuses !== undefined ? { startStatuses: input.startStatuses } : {}),
            ...(input.startTags !== undefined ? { startTags: input.startTags } : {}),
            ...(input.startRunStatuses !== undefined
              ? { startRunStatuses: input.startRunStatuses }
              : {}),
            ...(hasAgentConfigPatch(input)
              ? {
                  config: buildAgentConfig({
                    name,
                    existing: existing.value.config,
                    modelSelection: model,
                    patch: input,
                  }),
                }
              : {}),
            updatedAt: yield* now,
          };
          if (isDryRun)
            return {
              isError: false,
              text: json({
                dryRun: true,
                agent,
                resolution: resolution && compactTaskToolContext(resolution),
              }),
            };
          // Any edit of an enabled agent lets it run again on its matching tasks
          // (see runsAgain); disabling it starts nothing.
          const updateRefusal = agent.enabled
            ? runStartRefusal(context, agentRunModes(agent.config), "Changing an enabled agent")
            : null;
          if (updateRefusal !== null) return { isError: true, text: updateRefusal };
          const saved = yield* repository.upsertAgent(agent);
          yield* taskAgents.scheduleAgentChanged({ agent: saved, reason: "upserted" });
          if (saved.name !== existing.value.name) yield* bots.nameChat(saved.id);
          return {
            isError: false,
            text: json({
              agent: saved,
              resolution: resolution && compactTaskToolContext(resolution),
            }),
          };
        }
        case "agent_delete": {
          const input = yield* decoders.agent_delete(args);
          const existing = yield* repository.getAgentById(input);
          if (Option.isNone(existing))
            return { isError: true, text: `Agent '${input.id}' was not found.` };
          if (isDryRun)
            return {
              isError: false,
              text: json({ dryRun: true, deleted: true, agent: existing.value }),
            };
          yield* repository.deleteAgent(input);
          yield* taskAgents.scheduleAgentChanged({ agent: existing.value, reason: "deleted" });
          return { isError: false, text: json({ deleted: true, id: input.id }) };
        }
        case "agent_run_get": {
          const input = yield* decoders.agent_run_get(args);
          const run = yield* repository.getAgentRunById(input);
          return Option.isSome(run)
            ? { isError: false, text: json({ run: run.value }) }
            : { isError: true, text: `Agent run '${input.id}' was not found.` };
        }
        case "agent_run_search": {
          return {
            isError: false,
            text: json({
              runs: yield* repository.searchAgentRuns(yield* decoders.agent_run_search(args)),
            }),
          };
        }
        case "agent_run_transcript": {
          const input = yield* decoders.agent_run_transcript(args);
          if ((input.runId === undefined) === (input.threadId === undefined))
            return { isError: true, text: "Pass exactly one of runId or threadId." };
          const run = input.runId
            ? yield* repository.getAgentRunById({ id: input.runId })
            : input.threadId
              ? yield* repository.findLatestAgentRunByThreadId({ threadId: input.threadId })
              : Option.none<TaskAgentRun>();
          if (Option.isNone(run))
            return {
              isError: true,
              text:
                input.runId !== undefined
                  ? `Agent run '${input.runId}' was not found.`
                  : `Thread '${input.threadId}' does not belong to a task-agent run.`,
            };
          const thread = yield* threads
            .getThreadRecords(run.value.threadId, ["messages", "turnItems", "runs"])
            .pipe(Effect.option);
          return Option.isSome(thread)
            ? {
                isError: false,
                text: json(buildAgentRunTranscript(run.value, thread.value, input)),
              }
            : {
                isError: true,
                text: json({
                  error: `Thread '${run.value.threadId}' was not found.`,
                  run: run.value,
                }),
              };
        }
        case "agent_run_stop": {
          const input = yield* decoders.agent_run_stop(args);
          const existing = yield* repository.getAgentRunById(input);
          if (Option.isNone(existing))
            return { isError: true, text: `Agent run '${input.id}' was not found.` };
          if (existing.value.completedAt !== null)
            return {
              isError: true,
              text: json({ error: "The run has already ended.", run: existing.value }),
            };
          if (isDryRun)
            return { isError: false, text: json({ dryRun: true, run: existing.value }) };
          const run = yield* taskAgents.stopRun(input);
          return { isError: false, text: json({ run: Option.getOrNull(run) }) };
        }
        case "agent_run_message": {
          const input = yield* decoders.agent_run_message(args);
          if (isDryRun) {
            const existing = yield* repository.getAgentRunById({ id: input.runId });
            return Option.isSome(existing)
              ? {
                  isError: false,
                  text: json({ dryRun: true, run: existing.value, text: input.text }),
                }
              : { isError: true, text: `Agent run '${input.runId}' was not found.` };
          }
          const target = yield* repository.getAgentRunById({ id: input.runId });
          if (Option.isNone(target))
            return { isError: true, text: `Agent run '${input.runId}' was not found.` };
          // The message runs in the run's thread, in that thread's modes.
          const targetThread = yield* threads
            .getThreadShell(target.value.threadId)
            .pipe(Effect.orElseSucceed(() => null));
          const messageRefusal = runStartRefusal(
            context,
            // A missing thread is refused by messageRun; until then, fail closed.
            targetThread ?? { runtimeMode: "full-access", interactionMode: "default" },
            "Messaging an agent run",
          );
          if (messageRefusal !== null) return { isError: true, text: messageRefusal };
          const result = yield* taskAgents.messageRun({ id: input.runId, text: input.text });
          return result.ok
            ? {
                isError: false,
                text: json({
                  run: result.run,
                  continued: result.continued,
                  ...(result.continued ? { continuesRunId: input.runId } : {}),
                }),
              }
            : {
                isError: true,
                text: json({
                  error: result.error,
                  ...(result.activeRunId !== undefined ? { activeRunId: result.activeRunId } : {}),
                }),
              };
        }
        case "automation_get": {
          const input = yield* decoders.automation_get(args);
          const automation = yield* repository.getAutomationById(input);
          return Option.isSome(automation)
            ? { isError: false, text: json({ automation: automation.value }) }
            : { isError: true, text: `Automation '${input.id}' was not found.` };
        }
        case "automation_search": {
          return {
            isError: false,
            text: json({
              automations: yield* repository.searchAutomations(
                yield* decoders.automation_search(args),
              ),
            }),
          };
        }
        case "automation_create": {
          const input = yield* decoders.automation_create(args);
          const resolution = yield* resolver.resolve({
            args: {
              ...(input.projectId ? { projectId: input.projectId } : {}),
              ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
            },
            invocationContext: context,
          });
          if (!resolution.resolvedProject)
            return {
              isError: true,
              text: json({
                error:
                  "Couldn't tell which project this belongs to. Name the project, or start from a chat inside it.",
                resolution,
              }),
            };
          const projectId = resolution.resolvedProject.project.id;
          const schedule = {
            cron: input.cron,
            timezone: input.timezone ?? DEFAULT_AUTOMATION_TIMEZONE,
          };
          const parsed = parseAutomationCron(schedule);
          if (Result.isFailure(parsed)) return { isError: true, text: parsed.failure };
          const drafts = yield* repository.countAutomationDrafts({ projectId });
          if (drafts >= AUTOMATION_DRAFT_LIMIT_PER_PROJECT)
            return {
              isError: true,
              text: `This project already has ${drafts} automation drafts awaiting review. Ask the user to review or delete some before proposing more.`,
            };
          const timestamp = yield* now;
          const automation: TaskAutomation = {
            id: TaskAutomationId.make(yield* randomId("task-automation")),
            projectId,
            name: input.name,
            // Not derived from input: tools cannot arm an automation.
            status: "draft",
            schedule,
            template: normalizeAutomationTemplate(input.template),
            catchUpPolicy: input.catchUpPolicy ?? DEFAULT_AUTOMATION_CATCH_UP_POLICY,
            skipIfOpen: input.skipIfOpen ?? true,
            createdBy: "agent",
            sourceThreadId: context.threadId ?? null,
            nextRunAt: null,
            lastFiredAt: null,
            lastFiredSlot: null,
            lastTaskId: null,
            lastError: null,
            failureCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          if (isDryRun)
            return {
              isError: false,
              text: json({
                dryRun: true,
                automation,
                resolution: compactTaskToolContext(resolution),
              }),
            };
          // A plain insert, not an upsert: the tool path must never be able to
          // write over an automation a person has already reviewed.
          const saved = yield* repository.insertAutomation(automation);
          yield* recordFirstUse("app.first_automation_created", { via: "agent" });
          return {
            isError: false,
            text: json({
              automation: saved,
              review:
                "Saved as a draft. It will not run until the user enables it in the Automations tab.",
            }),
          };
        }
        case "automation_update": {
          const input = yield* decoders.automation_update(args);
          const existing = yield* repository.getAutomationById({ id: input.id });
          if (Option.isNone(existing))
            return { isError: true, text: `Automation '${input.id}' was not found.` };
          const refusal = automationToolWriteRefusal(existing.value);
          if (refusal) return { isError: true, text: refusal };
          const schedule = {
            cron: input.cron ?? existing.value.schedule.cron,
            timezone: input.timezone ?? existing.value.schedule.timezone,
          };
          const parsed = parseAutomationCron(schedule);
          if (Result.isFailure(parsed)) return { isError: true, text: parsed.failure };
          const automation: TaskAutomation = {
            ...existing.value,
            ...(input.name !== undefined ? { name: input.name } : {}),
            schedule,
            ...(input.template !== undefined
              ? {
                  template: normalizeAutomationTemplate(input.template, existing.value.template),
                }
              : {}),
            ...(input.catchUpPolicy !== undefined ? { catchUpPolicy: input.catchUpPolicy } : {}),
            ...(input.skipIfOpen !== undefined ? { skipIfOpen: input.skipIfOpen } : {}),
            updatedAt: yield* now,
          };
          if (isDryRun) return { isError: false, text: json({ dryRun: true, automation }) };
          return {
            isError: false,
            text: json({ automation: yield* repository.upsertAutomation(automation) }),
          };
        }
        case "automation_delete": {
          const input = yield* decoders.automation_delete(args);
          const existing = yield* repository.getAutomationById(input);
          if (Option.isNone(existing))
            return { isError: true, text: `Automation '${input.id}' was not found.` };
          const refusal = automationToolWriteRefusal(existing.value);
          if (refusal) return { isError: true, text: refusal };
          if (isDryRun)
            return {
              isError: false,
              text: json({ dryRun: true, deleted: true, automation: existing.value }),
            };
          yield* repository.deleteAutomation(input);
          return { isError: false, text: json({ deleted: true, id: input.id }) };
        }
        case "instructions_get": {
          const input = yield* decoders.instructions_get(args);
          const { project, error } = yield* instructionsProject(input.projectId);
          if (error !== null) return { isError: true, text: error };
          const state = yield* promptSettings.getState;
          if (project !== null) {
            const projectState = yield* promptSettings.getProject(project.id);
            return {
              isError: false,
              text: json({
                project,
                revision: projectState.revision,
                fields: Object.fromEntries(
                  TASK_PROMPT_FIELDS.map((field) => {
                    const text = projectState.settings[field];
                    return [
                      field,
                      {
                        text,
                        length: text.length,
                        use: `${INSTRUCTION_FIELD_USE[field]} ${PROJECT_FIELD_NOTE}`,
                      },
                    ];
                  }),
                ),
                global: {
                  note: "The global texts these are added to, for context. Edit them without projectId.",
                  revision: state.revision,
                  fields: state.settings,
                },
                triggerRules: {
                  editable: false,
                  note: "Server behavior, listed for reference. Not part of the instructions and cannot be edited.",
                  rules: TASK_TRIGGER_RULES,
                },
              }),
            };
          }
          return {
            isError: false,
            text: json({
              revision: state.revision,
              fields: Object.fromEntries(
                INSTRUCTIONS_FIELDS.map((field) => {
                  const text = field === "allChats" ? state.allChats : state.settings[field];
                  return [field, { text, length: text.length, use: INSTRUCTION_FIELD_USE[field] }];
                }),
              ),
              triggerRules: {
                editable: false,
                note: "Server behavior, listed for reference. Not part of the instructions and cannot be edited.",
                rules: TASK_TRIGGER_RULES,
              },
            }),
          };
        }
        case "instructions_update": {
          const input = yield* decoders.instructions_update(args);
          const access = yield* instructionsWriteAccess(name, context);
          if (access.refusal !== null) return { isError: true, text: access.refusal };
          if (input.projectId !== undefined && input.field === "allChats")
            return { isError: true, text: ALL_CHATS_IS_GLOBAL };
          const { project, error } = yield* instructionsProject(input.projectId);
          if (error !== null) return { isError: true, text: error };
          if (
            input.field === "allChats" &&
            input.text.trim().length > CUSTOM_INSTRUCTIONS_MAX_CHARS
          )
            return {
              isError: true,
              text: `allChats is limited to ${CUSTOM_INSTRUCTIONS_MAX_CHARS} characters. Shorten the text.`,
            };
          const result = yield* promptSettings.updateField({
            ...input,
            projectId: project?.id ?? null,
            origin: access.origin,
            dryRun: isDryRun,
          });
          if (!result.ok)
            return {
              isError: true,
              text: json({
                error: `The instructions changed since revision ${input.expectedRevision}. Call instructions_get again, redo your edit on the current text, and retry with the new revision.`,
                currentRevision: result.currentRevision,
              }),
            };
          return {
            isError: false,
            text: json({
              ...(isDryRun ? { dryRun: true } : {}),
              ...(project === null ? {} : { project }),
              revision: result.state.revision,
              ...(result.change === null
                ? { changed: false, note: "The text is already identical; nothing was recorded." }
                : {
                    changed: true,
                    ...(isDryRun ? {} : { changeId: result.change.id }),
                    summary: describeInstructionsChange(
                      input.field,
                      result.change.previousText,
                      result.change.newText,
                    ),
                  }),
            }),
          };
        }
        case "instructions_history": {
          const input = yield* decoders.instructions_history(args);
          if (input.projectId !== undefined && input.field === "allChats")
            return { isError: true, text: ALL_CHATS_IS_GLOBAL };
          const { project, error } = yield* instructionsProject(input.projectId);
          if (error !== null) return { isError: true, text: error };
          const changes = yield* promptSettings.history({
            projectId: project?.id ?? null,
            field: input.field,
            limit: input.limit ?? 20,
          });
          return { isError: false, text: json({ changes: changes.map(instructionsChangeView) }) };
        }
        case "instructions_revert": {
          const input = yield* decoders.instructions_revert(args);
          const access = yield* instructionsWriteAccess(name, context);
          if (access.refusal !== null) return { isError: true, text: access.refusal };
          const { project, error } = yield* instructionsProject(input.projectId);
          if (error !== null) return { isError: true, text: error };
          const result = yield* promptSettings.revert({
            projectId: project?.id ?? null,
            changeId: input.changeId,
            reason: input.reason ?? null,
            origin: access.origin,
            dryRun: isDryRun,
          });
          if (!result.ok)
            return result.reason === "not-found"
              ? {
                  isError: true,
                  text: `Instructions change '${input.changeId}' was not found in ${project === null ? "the global instructions" : `project '${project.id}'`}. Use instructions_history with the same projectId to find change ids.`,
                }
              : {
                  isError: true,
                  text: json({
                    error: `${result.reverted.field} changed after this change, so reverting it would also undo the later changes below. Revert those first, newest first, or edit the field with instructions_update.`,
                    laterChanges: result.laterChanges.map(
                      ({ id, revision, reason, createdAt }) => ({
                        changeId: id,
                        revision,
                        reason,
                        createdAt,
                      }),
                    ),
                  }),
                };
          return {
            isError: false,
            text: json({
              ...(isDryRun ? { dryRun: true } : {}),
              revertedChangeId: result.reverted.id,
              revision: result.state.revision,
              ...(result.change === null
                ? {
                    changed: false,
                    note: "The field already has the text from before this change; nothing was recorded.",
                  }
                : {
                    changed: true,
                    ...(isDryRun ? {} : { changeId: result.change.id }),
                    summary: describeInstructionsChange(
                      result.change.field,
                      result.change.previousText,
                      result.change.newText,
                    ),
                  }),
            }),
          };
        }
        default:
          return { isError: true, text: `Unknown task tool: ${name}` };
      }
    }).pipe(
      Effect.map((result) => (dryRun(context) ? withDryRunNotice(result, context) : result)),
      Effect.catch((cause) =>
        Effect.succeed({
          isError: true,
          // The person reads the first line; the agent also gets the exact reason.
          text: `Couldn't run ${name}, so nothing was changed.${
            cause instanceof Error && cause.message.trim().length > 0
              ? `\n\nDetails: ${cause.message}`
              : ""
          }`,
        }),
      ),
    );

  return { call } satisfies TaskToolServiceShape;
});

export const TaskToolServiceLive = Layer.effect(TaskToolService, make);
