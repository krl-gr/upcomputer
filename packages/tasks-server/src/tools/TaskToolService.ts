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
  TaskAppendEventInput,
  TaskDeleteInput,
  TaskEventId,
  TaskGetInput,
  TaskId,
  TaskAgentId,
  TaskAutomationId,
  TaskReorderInput,
  TaskSearchInput,
  TaskToolContextInput,
  TaskToolCreateInput,
  TaskUpdateInput,
  type Task,
  type TaskAgent,
  type TaskAgentRun,
  type TaskAutomation,
} from "@upcomputer/tasks-contracts/v1";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { ModelSelection, OrchestrationThread } from "@upcomputer/contracts";

import {
  ProjectionSnapshotQuery,
  type ExperimentalDynamicToolInvocationContext,
} from "../../../../apps/server/src/extensionApi.ts";
import { releasedRunId, TaskAgentService } from "../agents/TaskAgentService.ts";
import { parseAutomationCron } from "../automations/automationSchedule.ts";
import { automationToolWriteRefusal } from "../automations/automationToolPolicy.ts";
import { normalizeAutomationTemplate } from "../automations/automationWrites.ts";
import { TaskToolContextResolver } from "../context/TaskToolContextResolver.ts";
import { TaskRepository, type PersistTaskInput } from "../persistence/TaskRepository.ts";
import { TaskPromptSettingsStore } from "../persistence/TaskPromptSettingsStore.ts";
import { TASK_TRIGGER_RULES } from "./TaskToolDefinitions.ts";
import { TaskToolService, type TaskToolServiceShape } from "./TaskToolServiceTag.ts";

export { TaskToolService } from "./TaskToolServiceTag.ts";
export type { TaskToolServiceShape } from "./TaskToolServiceTag.ts";

const decoders = {
  task_context: Schema.decodeUnknownEffect(TaskToolContextInput),
  task_get: Schema.decodeUnknownEffect(TaskGetInput),
  task_search: Schema.decodeUnknownEffect(TaskSearchInput),
  task_create: Schema.decodeUnknownEffect(TaskToolCreateInput),
  task_update: Schema.decodeUnknownEffect(TaskUpdateInput),
  task_reorder: Schema.decodeUnknownEffect(TaskReorderInput),
  task_delete: Schema.decodeUnknownEffect(TaskDeleteInput),
  task_event_append: Schema.decodeUnknownEffect(TaskAppendEventInput),
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
} as const;

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

function buildAgentRunTranscript(
  run: TaskAgentRun,
  thread: OrchestrationThread,
  input: typeof AgentRunTranscriptInput.Type,
) {
  const entries: TranscriptEntry[] = [
    ...thread.messages.map((message) => ({
      type: "message" as const,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    })),
    ...(input.includeActivities === false
      ? []
      : thread.activities.map((activity) => ({
          type: "activity" as const,
          kind: activity.kind,
          summary: activity.summary,
          createdAt: activity.createdAt,
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
    failureReason: thread.session?.lastError ?? null,
    olderEntriesOmitted: kept.length < entries.length,
    entries: kept,
  };
}

function dryRun(context: ExperimentalDynamicToolInvocationContext): boolean {
  // The host resolves the active interaction mode and supplies its effective
  // safety policy. Missing policy fails closed for older or unknown callers.
  return context.mutationPolicy !== "allow";
}

function patchTask(existing: Task, update: typeof TaskUpdateInput.Type, updatedAt: string): Task {
  return {
    ...existing,
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
    ...(update.closedAt !== undefined ? { closedAt: update.closedAt } : {}),
    ...(update.notBefore !== undefined ? { notBefore: update.notBefore } : {}),
    updatedAt,
  };
}

export type AgentCreateModelDecision =
  | { readonly ok: true; readonly modelSelection: ModelSelection }
  | { readonly ok: false; readonly reason: "missing-explicit-selection" | "unresolved-selection" };

export function resolveAgentCreateModelDecision(
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

export function resolveAgentUpdateModelSelection(
  input: typeof AgentUpdateInput.Type,
  existing: ModelSelection,
  resolvedModel: ModelSelection | undefined,
): ModelSelection {
  return (
    input.modelSelection ??
    input.config?.modelSelection ??
    (input.modelAlias !== undefined ? resolvedModel : undefined) ??
    existing
  );
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
  const projections = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const randomId = (prefix: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => `${prefix}-${uuid}`));
  const call: TaskToolServiceShape["call"] = ({ name, args, context }) =>
    Effect.gen(function* () {
      const isDryRun = dryRun(context);
      switch (name) {
        case "task_context": {
          return {
            isError: false,
            text: json({
              ...(yield* resolver.resolve({
                args: yield* decoders.task_context(args),
                invocationContext: context,
              })),
              promptGuidance: yield* promptSettings.get,
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
          return {
            isError: false,
            text: json({ tasks: yield* repository.search(yield* decoders.task_search(args)) }),
          };
        }
        case "task_create": {
          const input = yield* decoders.task_create(args);
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
              text: json({ error: "Unable to resolve project.", resolution }),
            };
          const timestamp = yield* now;
          const task: PersistTaskInput = {
            id: input.id ?? TaskId.make(yield* randomId("task")),
            projectId: resolution.resolvedProject.project.id,
            title: input.title,
            description: input.description,
            output: input.output ?? null,
            status: input.status,
            priority: input.priority ?? null,
            createdBy: input.createdBy ?? "agent",
            assigneeAgentRunId: input.assigneeAgentRunId ?? null,
            originThreadId: context.threadId ?? null,
            sourceThreadId:
              input.sourceThreadId === undefined
                ? (context.threadId ?? null)
                : input.sourceThreadId,
            sourceRunId: input.sourceRunId ?? null,
            metadata: input.metadata ?? null,
            tags: input.tags ?? [],
            notBefore: input.notBefore ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
            closedAt: null,
          };
          if (isDryRun) return { isError: false, text: json({ dryRun: true, task, resolution }) };
          const saved = yield* repository.upsert(task);
          yield* taskAgents.scheduleTaskChanged({ task: saved, reason: "created" });
          return { isError: false, text: json({ task: saved }) };
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
          const task = yield* repository.update(input);
          const callerRun = context.threadId
            ? yield* repository.findActiveAgentRunByThreadId({ threadId: context.threadId })
            : Option.none<TaskAgentRun>();
          yield* taskAgents.scheduleTaskChanged({
            task,
            reason: "updated",
            releasedRunId: Option.isSome(before)
              ? releasedRunId({
                  before: before.value,
                  after: task,
                  requestedAssignee: input.assigneeAgentRunId,
                  callerRun: Option.getOrNull(callerRun),
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
              text: json({ error: "Unable to resolve agent project.", resolution }),
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
          if (isDryRun) return { isError: false, text: json({ dryRun: true, agent, resolution }) };
          const saved = yield* repository.upsertAgent(agent);
          yield* taskAgents.scheduleAgentChanged({ agent: saved, reason: "upserted" });
          return { isError: false, text: json({ agent: saved, resolution }) };
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
              text: json({ error: "Unable to resolve agent project.", resolution }),
            };
          const name = input.name ?? existing.value.name;
          const model = resolveAgentUpdateModelSelection(
            input,
            existing.value.config.modelSelection,
            resolution?.resolvedModel?.modelSelection,
          );
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
          if (isDryRun) return { isError: false, text: json({ dryRun: true, agent, resolution }) };
          const saved = yield* repository.upsertAgent(agent);
          yield* taskAgents.scheduleAgentChanged({ agent: saved, reason: "upserted" });
          return { isError: false, text: json({ agent: saved, resolution }) };
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
          const thread = yield* projections.getThreadDetailById(run.value.threadId);
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
              text: json({ error: "Unable to resolve project.", resolution }),
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
            return { isError: false, text: json({ dryRun: true, automation, resolution }) };
          // A plain insert, not an upsert: the tool path must never be able to
          // write over an automation a person has already reviewed.
          const saved = yield* repository.insertAutomation(automation);
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
        default:
          return { isError: true, text: `Unknown task tool: ${name}` };
      }
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed({
          isError: true,
          text: cause instanceof Error ? cause.message : `Task tool '${name}' failed.`,
        }),
      ),
    );

  return { call } satisfies TaskToolServiceShape;
});

export const TaskToolServiceLive = Layer.effect(TaskToolService, make);
