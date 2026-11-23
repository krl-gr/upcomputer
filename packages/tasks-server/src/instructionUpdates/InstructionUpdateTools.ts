import {
  InstructionUpdateDecideInput,
  instructionUpdatesBrief,
  InstructionUpdatesToolGetInput,
  TaskListSettingsUpdateInput,
  TaskStatusRenameInput,
  TaskWorkflowVersionSetInput,
  type TaskActor,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { BotService } from "../bots/BotService.ts";
import type { TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import type { TaskToolCallResult, TaskToolInvocationContext } from "../tools/TaskToolTypes.ts";
import type { InstructionUpdatesServiceShape } from "./InstructionUpdatesService.ts";

export const INSTRUCTION_UPDATE_TOOL_NAMES = [
  "instruction_updates_get",
  "instruction_update_decide",
  "task_status_rename",
  "task_list_settings_update",
  "task_workflow_version_set",
] as const;
type ToolName = (typeof INSTRUCTION_UPDATE_TOOL_NAMES)[number];

export const isInstructionUpdateTool = (name: string): name is ToolName =>
  (INSTRUCTION_UPDATE_TOOL_NAMES as ReadonlyArray<string>).includes(name);

const decoders = {
  instruction_updates_get: Schema.decodeUnknownEffect(InstructionUpdatesToolGetInput),
  instruction_update_decide: Schema.decodeUnknownEffect(InstructionUpdateDecideInput),
  task_status_rename: Schema.decodeUnknownEffect(TaskStatusRenameInput),
  task_list_settings_update: Schema.decodeUnknownEffect(TaskListSettingsUpdateInput),
  task_workflow_version_set: Schema.decodeUnknownEffect(TaskWorkflowVersionSetInput),
};

const json = (value: unknown) => JSON.stringify(value, null, 2);

export interface InstructionUpdateToolDeps {
  readonly updates: InstructionUpdatesServiceShape;
  readonly repository: TaskRepositoryShape;
  readonly bots: Pick<BotService["Service"], "forThread">;
  /** The instructions tools' guard: a task-agent run writes only when its agent lists the tool. */
  readonly writeRefusal: (
    name: string,
    context: TaskToolInvocationContext,
  ) => Effect.Effect<string | null, unknown>;
  readonly actor: (context: TaskToolInvocationContext) => Effect.Effect<TaskActor, unknown>;
}

/**
 * The tools a bot applies an instruction update with: read the updates, rename
 * statuses in bulk, reorder the Tasks list's groups, switch the workflow and
 * record the decision. Instructions and workers have their own tools.
 */
export const callInstructionUpdateTool = Effect.fn("InstructionUpdateTools.call")(function* (
  deps: InstructionUpdateToolDeps,
  input: {
    readonly name: ToolName;
    readonly args: Record<string, unknown>;
    readonly context: TaskToolInvocationContext;
    readonly dryRun: boolean;
  },
) {
  const { name, args, context, dryRun } = input;
  const result = (value: unknown): TaskToolCallResult => ({
    isError: false,
    text: json(
      dryRun && name !== "instruction_updates_get" ? { dryRun: true, ...(value as object) } : value,
    ),
  });
  if (name === "instruction_updates_get") {
    const request = yield* decoders.instruction_updates_get(args);
    const details = yield* deps.updates.details;
    const found =
      request.id === undefined ? undefined : details.entries.find((item) => item.id === request.id);
    if (request.id !== undefined && found === undefined)
      return { isError: true, text: `Instruction update '${request.id}' was not found.` };
    return result({
      mode: details.mode,
      workflowVersion: details.workflowVersion,
      statusGroupOrder: details.listSettings.statusGroupOrder,
      statusGroupOpen: details.listSettings.statusGroupOpen,
      entries: details.entries.map((item) => ({
        id: item.id,
        title: item.entry.title,
        release: item.entry.release,
        state: item.state,
        decidedAt: item.decidedAt,
        decidedBy: item.decidedBy,
        editedFields: item.edited.editedFields,
        mentions: item.edited.mentions,
      })),
      ...(found === undefined ? {} : { brief: instructionUpdatesBrief([found.entry]) }),
    });
  }

  const refusal = yield* deps.writeRefusal(name, context);
  if (refusal !== null) return { isError: true, text: refusal };

  switch (name) {
    case "instruction_update_decide": {
      const request = yield* decoders.instruction_update_decide(args);
      const details = yield* deps.updates.details;
      const found = details.entries.find((item) => item.id === request.id);
      if (found === undefined)
        return { isError: true, text: `Instruction update '${request.id}' was not found.` };
      const needed = found.entry.workflowVersion;
      // A person cannot reopen an applied entry, so it must not close half done.
      if (request.state === "applied" && needed !== undefined && details.workflowVersion < needed)
        return {
          isError: true,
          text: `This install is still on workflow ${details.workflowVersion}. Call task_workflow_version_set with version ${needed} first, then mark '${request.id}' applied.`,
        };
      if (dryRun) return result({ id: request.id, state: request.state });
      const bot = context.threadId ? yield* deps.bots.forThread(context.threadId) : null;
      const status = yield* deps.updates.decide({
        id: request.id,
        state: request.state,
        decidedBy: { kind: "chat", name: bot?.agent.name ?? null },
      });
      if (Option.isNone(status))
        return { isError: true, text: `Instruction update '${request.id}' was not found.` };
      return result({ ...status.value, note: "Recorded. Tell the user in one line." });
    }
    case "task_status_rename": {
      const request = yield* decoders.task_status_rename(args);
      const renamed = yield* deps.repository.renameTaskStatus({
        ...request,
        actor: yield* deps.actor(context),
        dryRun,
      });
      return result({
        from: request.from,
        to: request.to,
        renamed: renamed.renamed.length,
        ids: renamed.renamed,
        skipped: renamed.skipped,
        automations: renamed.automations,
        ...(renamed.renamed.length > 0
          ? { undo: `task_status_rename from "${request.to}" to "${request.from}" with these ids.` }
          : {}),
      });
    }
    case "task_list_settings_update": {
      const request = yield* decoders.task_list_settings_update(args);
      const previous = yield* deps.repository.listSettings();
      const shape = (settings: typeof previous) => ({
        groupByStatus: settings.groupByStatus,
        statusGroupOrder: settings.statusGroupOrder,
        statusGroupOpen: settings.statusGroupOpen,
      });
      if (dryRun) return result({ previous: shape(previous), requested: request });
      const current = yield* deps.repository.updateListSettings(request);
      return result({ previous: shape(previous), current: shape(current) });
    }
    case "task_workflow_version_set": {
      const request = yield* decoders.task_workflow_version_set(args);
      const previous = yield* deps.repository.workflowVersion();
      if (!dryRun) yield* deps.repository.setWorkflowVersion(request);
      return result({ previous, version: request.version });
    }
  }
});
