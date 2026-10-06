/**
 * The task system's part of the one-time UpComputer V1 to v2 data cutover.
 * The task tables carry over as they are; this interrupts the runs V1 left in
 * flight and moves stored instructions off the V1 tool names. Core's cutover
 * command runs it once, on the copied database, before the server starts.
 */
import {
  INSTRUCTIONS_FIELDS,
  TASK_PROMPT_FIELDS,
  TaskEventId,
  type InstructionsField,
  type TaskAgentRun,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { TASK_AGENT_RUN_RECOVERY_HINT } from "../agents/TaskAgentService.ts";
import { TaskPromptSettingsStore } from "../persistence/TaskPromptSettingsStore.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";

/** V1 workspace tools that v2 serves under upstream's names. */
const RENAMED_V1_TOOLS: Readonly<Record<string, string>> = {
  project_list: "t3_project_list",
  project_create: "t3_project_create",
  project_set_linked_projects: "t3_project_update",
  thread_search: "t3_thread_search",
  thread_read: "t3_thread_read",
};

/** v2 serves every tool from the core MCP server, which providers see as `t3-code`. */
const V2_MCP_TOOL_PREFIX = "mcp__t3-code__";

const PREFIXED_V1_TOOL = /\bmcp__upcomputer(?:_tasks)?__([A-Za-z0-9_]+)/g;
const V1_TASK_SERVER = /\bupcomputer_tasks\b/g;
const BARE_RENAMED_V1_TOOL = new RegExp(
  `(?<![A-Za-z0-9_-])(${Object.keys(RENAMED_V1_TOOLS).join("|")})(?![A-Za-z0-9_])`,
  "g",
);

export interface V1ToolNameRewrite {
  readonly text: string;
  /** "from -> to" for every rewritten occurrence. */
  readonly replacements: ReadonlyArray<string>;
}

/** Rewrites V1 MCP tool names to the names v2 serves. */
export function rewriteV1ToolNames(text: string): V1ToolNameRewrite {
  const replacements: Array<string> = [];
  const replace = (from: string, to: string) => {
    replacements.push(`${from} -> ${to}`);
    return to;
  };
  const rewritten = text
    .replace(PREFIXED_V1_TOOL, (match, name: string) =>
      replace(match, `${V2_MCP_TOOL_PREFIX}${RENAMED_V1_TOOLS[name] ?? name}`),
    )
    .replace(V1_TASK_SERVER, (match) => replace(match, "t3-code"))
    .replace(BARE_RENAMED_V1_TOOL, (match) => replace(match, RENAMED_V1_TOOLS[match] ?? match));
  return { text: rewritten, replacements };
}

export const V1_CUTOVER_INTERRUPT_REASON =
  "Up.computer moved to the new engine while this run was in flight. Its V1 provider session cannot continue there.";

export interface TaskV1CutoverReport {
  readonly interruptedRuns: ReadonlyArray<{
    readonly runId: string;
    readonly taskId: string;
    readonly threadId: string;
  }>;
  /** Active runs another finalizer already claimed; v2's recovery settles them. */
  readonly leftForRecovery: ReadonlyArray<string>;
  readonly rewrittenAgents: ReadonlyArray<{
    readonly agentId: string;
    readonly name: string;
    readonly replacements: ReadonlyArray<string>;
  }>;
  readonly rewrittenInstructions: ReadonlyArray<{
    readonly projectId: string | null;
    readonly field: InstructionsField;
    readonly replacements: ReadonlyArray<string>;
  }>;
  /** Reported only: task descriptions are the user's record and stay as written. */
  readonly taskDescriptionsNamingV1Tools: ReadonlyArray<{
    readonly taskId: string;
    readonly title: string;
    readonly names: ReadonlyArray<string>;
  }>;
}

const interruptRun = (run: TaskAgentRun, now: string) =>
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    const finalizingStatus = "finalizing:interrupted";
    if (!(yield* repository.claimAgentRunFinalization({ id: run.id, finalizingStatus }))) {
      return false;
    }
    const task = yield* repository.getById({ id: run.taskId });
    const note = `Task-agent run ${run.id} interrupted: ${V1_CUTOVER_INTERRUPT_REASON} ${TASK_AGENT_RUN_RECOVERY_HINT}`;
    const existingOutput = Option.isSome(task) ? (task.value.output?.trim() ?? "") : "";
    return yield* repository.finalizeAgentRun({
      id: run.id,
      finalizingStatus,
      status: "interrupted",
      completedAt: now,
      taskId: run.taskId,
      ...(Option.isSome(task)
        ? { taskOutput: existingOutput ? `${existingOutput}\n\n${note}` : note }
        : {}),
      releaseAssignment: true,
      events: Option.isSome(task)
        ? [
            {
              // The id TaskAgentService uses, so a later v2 recovery cannot add a second one.
              id: TaskEventId.make(`${run.id}:task-agent-interrupted`),
              taskId: run.taskId,
              kind: "task.agent-interrupted",
              payload: {
                agentId: run.agentId,
                agentRunId: run.id,
                threadId: run.threadId,
                reason: V1_CUTOVER_INTERRUPT_REASON,
                recovery: TASK_AGENT_RUN_RECOVERY_HINT,
              },
              createdAt: now,
            },
          ]
        : [],
    });
  });

/**
 * Interrupts V1's in-flight runs and rewrites V1 tool names in agent
 * instructions and instruction settings. Every instruction change is recorded
 * in the instruction history, so it can be reverted like any other edit.
 */
export const runTaskV1Cutover = Effect.fn("runTaskV1Cutover")(function* (input: {
  readonly now: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const repository = yield* TaskRepository;
  const instructions = yield* TaskPromptSettingsStore;

  const interruptedRuns: Array<TaskV1CutoverReport["interruptedRuns"][number]> = [];
  const leftForRecovery: Array<string> = [];
  for (const run of yield* repository.listAllActiveAgentRuns()) {
    if (yield* interruptRun(run, input.now)) {
      interruptedRuns.push({ runId: run.id, taskId: run.taskId, threadId: run.threadId });
      // Like every run that ended on V1 (task migration 17): its source chat
      // is not woken, which would start a turn there on v2's first start.
      yield* sql`UPDATE task_agent_runs SET source_wake_at = ${input.now} WHERE id = ${run.id}`;
    } else {
      leftForRecovery.push(run.id);
    }
  }

  const rewrittenAgents: Array<TaskV1CutoverReport["rewrittenAgents"][number]> = [];
  for (const agent of yield* repository.listAllAgents()) {
    const rewrite = rewriteV1ToolNames(agent.config.instructions);
    const tools = agent.config.tools?.map((tool) => rewriteV1ToolNames(tool));
    const replacements = [
      ...rewrite.replacements,
      ...(tools ?? []).flatMap((tool) => tool.replacements),
    ];
    if (replacements.length === 0) continue;
    yield* repository.upsertAgent({
      ...agent,
      config: {
        ...agent.config,
        instructions: rewrite.text,
        ...(tools === undefined ? {} : { tools: tools.map((tool) => tool.text) }),
      },
      // A mechanical rename, not an edit: a newer updatedAt would let the agent
      // run again on every matching task it already finished (see runsAgain).
      updatedAt: agent.updatedAt,
    });
    rewrittenAgents.push({ agentId: agent.id, name: agent.name, replacements });
  }

  const rewrittenInstructions: Array<TaskV1CutoverReport["rewrittenInstructions"][number]> = [];
  const projectIds = yield* sql<{ readonly project_id: string }>`
    SELECT project_id FROM task_project_prompt_settings ORDER BY project_id
  `;
  const rewriteField = (
    projectId: string | null,
    field: InstructionsField,
    current: string,
    revision: number,
  ) =>
    Effect.gen(function* () {
      const rewrite = rewriteV1ToolNames(current);
      if (rewrite.replacements.length === 0) return revision;
      const result = yield* instructions.updateField({
        projectId,
        field,
        text: rewrite.text,
        reason: "Cutover to v2: V1 tool names rewritten to the v2 names.",
        expectedRevision: revision,
        origin: { source: "unknown", threadId: null, runId: null },
        dryRun: false,
      });
      if (!result.ok) return revision;
      rewrittenInstructions.push({ projectId, field, replacements: rewrite.replacements });
      return result.state.revision;
    });
  const global = yield* instructions.getState;
  let revision = global.revision;
  for (const field of INSTRUCTIONS_FIELDS) {
    const current = field === "allChats" ? global.allChats : global.settings[field];
    revision = yield* rewriteField(null, field, current, revision);
  }
  for (const { project_id: projectId } of projectIds) {
    const project = yield* instructions.getProject(projectId);
    let projectRevision = project.revision;
    for (const field of TASK_PROMPT_FIELDS) {
      projectRevision = yield* rewriteField(
        projectId,
        field,
        project.settings[field],
        projectRevision,
      );
    }
  }

  const taskDescriptionsNamingV1Tools: Array<
    TaskV1CutoverReport["taskDescriptionsNamingV1Tools"][number]
  > = [];
  for (const task of yield* repository.listAllTasks()) {
    const { replacements } = rewriteV1ToolNames(task.description);
    if (replacements.length === 0) continue;
    taskDescriptionsNamingV1Tools.push({
      taskId: task.id,
      title: task.title,
      names: Array.from(new Set(replacements.map((replacement) => replacement.split(" -> ")[0]!))),
    });
  }

  return {
    interruptedRuns,
    leftForRecovery,
    rewrittenAgents,
    rewrittenInstructions,
    taskDescriptionsNamingV1Tools,
  } satisfies TaskV1CutoverReport;
});

export interface TaskSystemCounts {
  readonly tasks: number;
  readonly taskEvents: number;
  readonly taskTags: number;
  readonly runs: number;
  readonly activeRuns: number;
  readonly agents: number;
  readonly enabledAgents: number;
  /**
   * Every agent's id, enabled flag, triggers and updatedAt, in id order. An
   * agent edited after its last run runs again (see runsAgain), so updatedAt
   * is part of what decides whether it starts.
   */
  readonly agentTriggers: string;
  readonly automations: number;
  readonly instructionHistory: number;
}

/** Counts that must match before and after the cutover. Works on V1 and v2 schemas. */
export const countTaskSystem = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const count = (table: string, where = "1 = 1") =>
    sql<{ readonly n: number }>`
      SELECT COUNT(*) AS n FROM ${sql.literal(table)} WHERE ${sql.literal(where)}
    `.pipe(Effect.map((rows) => rows[0]?.n ?? 0));
  const triggers = yield* sql<{ readonly triggers: string | null }>`
    SELECT group_concat(entry, '\n') AS triggers FROM (
      SELECT id || ' ' || enabled || ' ' || start_statuses_json || ' ' || start_tags_json || ' ' ||
        start_run_statuses_json || ' ' || updated_at AS entry
      FROM task_agents ORDER BY id
    )
  `;
  return {
    tasks: yield* count("tasks"),
    taskEvents: yield* count("task_events"),
    taskTags: yield* count("task_tags"),
    runs: yield* count("task_agent_runs"),
    activeRuns: yield* count("task_agent_runs", "completed_at IS NULL"),
    agents: yield* count("task_agents"),
    enabledAgents: yield* count("task_agents", "enabled = 1"),
    agentTriggers: triggers[0]?.triggers ?? "",
    automations: yield* count("task_automations"),
    instructionHistory: yield* count("task_prompt_settings_changes"),
  } satisfies TaskSystemCounts;
});
