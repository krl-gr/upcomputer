import type { ExperimentalDynamicToolSpec } from "../../../../apps/server/src/extensionApi.ts";

const object = (
  properties: Record<string, unknown>,
  required: ReadonlyArray<string> = [],
): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length > 0 ? { required } : {}),
});

const id = { type: "string", minLength: 1 } as const;
const tags = { type: "array", items: id } as const;
const modelSelection = object(
  {
    instanceId: id,
    model: id,
    options: {
      type: "array",
      items: object({ id, value: { type: ["string", "boolean"] } }, ["id", "value"]),
    },
  },
  ["instanceId", "model"],
);

const runStatuses = {
  type: "array",
  items: { type: "string", enum: ["failed", "interrupted", "blocked"] },
} as const;
const dateTime = {
  type: ["string", "null"],
  description: "ISO 8601 date-time with offset, e.g. 2026-10-02T09:00:00Z. null clears it.",
} as const;

/** Server trigger semantics returned by task_context; not user-editable guidance. */
export const TASK_TRIGGER_RULES = [
  "An enabled agent starts on an open task when the task's status is in its startStatuses (empty means any), the task has all of its startTags, and the task's notBefore, if set, has passed.",
  "Setting a matching status or adding a matching tag starts the agent immediately. Park work in a status no agent starts on (for example Backlog), or set notBefore to delay it.",
  "An agent runs again on the same task only after the task's title, description, status, tags, notBefore or closedAt really changed after its previous run there ended, or after the agent itself was edited. Output, assignment, metadata and priority changes never restart agents. To retry, change the status or set notBefore (now or later).",
  "Several agents may run on one task at once. Such an agent should finish by removing its own trigger tag or moving the status; otherwise a later change starts it again.",
  "A started run keeps running while the task's status and tags change. It ends when it reports its task_agent_result, sets assigneeAgentRunId away from itself, is stopped with agent_run_stop, when the task is closed or deleted, or when the agent is disabled or deleted.",
  "An agent with startRunStatuses (failed, interrupted, blocked) does not start on task state alone. It starts once for each run of another agent on a matching task that ended with one of those statuses and is still that agent's latest run there. Runs started this way never trigger such agents. Use it for an agent that decides what happens after a failure.",
  "agent_run_message sends a message to any run's thread, regardless of triggers and notBefore: an active run receives it as its next turn; an ended run continues in its thread as a new run (continuesRunId) that ends like any run. It fails while the task is closed, the agent is disabled, or the agent has another active run on the task.",
  "failed means the server saw the run break (provider error, missing thread, no result). blocked means the agent itself reported it cannot continue. interrupted means the app restarted during the run, so after a restart it fires for every run that was active at once. Stopped runs (agent_run_stop, a person stopping the session or interrupting the turn) never trigger agents.",
] as const;

const automationTemplate = object(
  {
    title: id,
    description: { type: "string" },
    status: id,
    priority: { type: ["string", "null"] },
    tags,
  },
  ["title"],
);

const instructionField = {
  type: "string",
  enum: ["allChats", "taskCreation", "agentCreation", "automationCreation", "taskExecution"],
} as const;

/** One line in task_context pointing at the instructions tools. */
export const PROMPT_GUIDANCE_EDITING =
  "promptGuidance is the user's task instructions (Settings → Instructions): each global text, followed by the resolved project's addition under a `Project \"<title>\":` heading. Read them, and allChats, the instructions every chat gets, with instructions_get (projectId for a project's additions), edit one field with instructions_update, and see or undo changes with instructions_history and instructions_revert. triggerRules are server behavior and cannot be edited.";

/** Optional on every instructions tool: without it they act on the global texts. */
const instructionsProjectId = {
  ...id,
  description:
    "Act on this project's additions to the four task fields instead of the global texts. A project has no allChats.",
} as const;

const INSTRUCTIONS_WRITE_ACCESS =
  "Task-agent run threads, also after the run ended, are refused unless the run's agent lists this tool in its tools. This guards against accidental or injected writes by unattended agents; it is not a security boundary.";

export const TASK_TOOL_SPECS: ReadonlyArray<ExperimentalDynamicToolSpec> = [
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "task_context",
    description:
      "Resolve task project, model context, and configurable task orchestration guidance for this turn.",
    inputSchema: object({ projectId: id, workspaceRoot: id, modelSelection, modelAlias: id }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "task_get",
    description: "Load one task by id.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "task_search",
    description:
      "Search tasks in ascending global rank order. Project, status, and tag filters preserve relative global order within this environment.",
    inputSchema: object({ projectId: id, status: id, tags, limit: { type: "number" } }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "task_create",
    description:
      "Create a task in the resolved project. Call task_context first and follow its taskCreation guidance and triggerRules: a status or tag an agent starts on runs it immediately; set notBefore to delay.",
    inputSchema: object(
      {
        id,
        projectId: id,
        workspaceRoot: id,
        title: id,
        description: { type: "string" },
        output: { type: ["string", "null"] },
        status: id,
        priority: { type: ["string", "null"] },
        createdBy: id,
        assigneeAgentRunId: { type: ["string", "null"] },
        sourceThreadId: { type: ["string", "null"] },
        sourceRunId: { type: ["string", "null"] },
        metadata: {},
        tags,
        notBefore: dateTime,
      },
      ["title", "description", "status"],
    ),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "task_update",
    description:
      "Update task fields, status, output, and tags without changing its global rank. Status, tag and notBefore changes can start agents (see task_context triggerRules).",
    inputSchema: object(
      {
        id,
        title: id,
        description: { type: "string" },
        output: { type: ["string", "null"] },
        status: id,
        priority: { type: ["string", "null"] },
        assigneeAgentRunId: { type: ["string", "null"] },
        metadata: {},
        tags,
        closedAt: { type: ["string", "null"] },
        notBefore: dateTime,
      },
      ["id"],
    ),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "task_reorder",
    description:
      "Move one task in this environment's global order using semantic neighbors. The task and neighbors must belong to the same environment; omit afterTaskId at the beginning or beforeTaskId at the end.",
    inputSchema: object({ id, beforeTaskId: id, afterTaskId: id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "task_delete",
    description: "Delete one task.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "task_event_append",
    description: "Append a finding, note, or review event to a task.",
    inputSchema: object({ id, taskId: id, kind: id, payload: {} }, ["taskId", "kind"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "agent_get",
    description: "Load one task-agent definition.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "agent_search",
    description: "Search task-agent definitions.",
    inputSchema: object({
      projectId: { type: ["string", "null"] },
      enabled: { type: "boolean" },
      limit: { type: "number" },
    }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "agent_create",
    description:
      "Create a task-agent definition. Call task_context first and follow its agentCreation guidance and triggerRules.",
    inputSchema: object(
      {
        id,
        projectId: { type: ["string", "null"] },
        workspaceRoot: id,
        name: id,
        enabled: { type: "boolean" },
        startStatuses: tags,
        startTags: tags,
        startRunStatuses: runStatuses,
        modelSelection,
        modelAlias: id,
        role: id,
        runtimeMode: {
          type: "string",
          enum: ["approval-required", "auto-accept-edits", "full-access"],
        },
        interactionMode: id,
        tools: tags,
        skills: tags,
        instructions: id,
      },
      ["name"],
    ),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "agent_update",
    description: "Update a task-agent definition.",
    inputSchema: object(
      {
        id,
        projectId: { type: ["string", "null"] },
        workspaceRoot: id,
        name: id,
        enabled: { type: "boolean" },
        startStatuses: tags,
        startTags: tags,
        startRunStatuses: runStatuses,
        modelSelection,
        modelAlias: id,
        role: id,
        runtimeMode: {
          type: "string",
          enum: ["approval-required", "auto-accept-edits", "full-access"],
        },
        interactionMode: id,
        tools: tags,
        skills: tags,
        instructions: id,
      },
      ["id"],
    ),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "agent_delete",
    description: "Delete one task-agent definition.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "agent_run_get",
    description: "Load one task-agent run.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "agent_run_search",
    description: "Search task-agent runs.",
    inputSchema: object({ taskId: id, agentId: id, status: id, limit: { type: "number" } }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "agent_run_transcript",
    description:
      "Read what a task-agent run did: run status, failure reason, and the latest thread messages and activities in chronological order. Pass runId or threadId.",
    inputSchema: object({
      runId: id,
      threadId: id,
      tail: { type: "number" },
      includeActivities: { type: "boolean" },
      maxChars: { type: "number" },
    }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "agent_run_stop",
    description:
      "Stop an active task-agent run. It ends as stopped and does not restart until the task's status, tags, notBefore, title or description change.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "agent_run_message",
    description:
      "Send a message to a task-agent run's thread. An active run receives it as its next turn (queued or steered by the provider). An ended run of any status continues in the same thread, with its context, as a new run whose continuesRunId is the messaged run. Triggers and notBefore do not apply. Fails while the task is closed, the agent is disabled, or the agent already has another active run on the task (message that one instead).",
    inputSchema: object({ runId: id, text: id }, ["runId", "text"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "automation_get",
    description: "Load one scheduled automation.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "automation_search",
    description: "Search scheduled automations.",
    inputSchema: object({
      projectId: id,
      status: { type: "string", enum: ["draft", "enabled", "disabled"] },
      limit: { type: "number" },
    }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "automation_create",
    description:
      "Propose a scheduled automation that creates a task on a cron schedule. Call task_context first and follow its automationCreation guidance. The automation is saved as an inert draft and only a person can activate it.",
    inputSchema: object(
      {
        projectId: id,
        workspaceRoot: id,
        name: id,
        cron: id,
        timezone: id,
        template: automationTemplate,
        catchUpPolicy: { type: "string", enum: ["skip", "fire-once"] },
        skipIfOpen: { type: "boolean" },
      },
      ["name", "cron", "template"],
    ),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "automation_update",
    description:
      "Update a draft automation. Automations a person has already reviewed are read-only from tools.",
    inputSchema: object(
      {
        id,
        name: id,
        cron: id,
        timezone: id,
        template: automationTemplate,
        catchUpPolicy: { type: "string", enum: ["skip", "fire-once"] },
        skipIfOpen: { type: "boolean" },
      },
      ["id"],
    ),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "automation_delete",
    description:
      "Delete a draft automation. Automations a person has already reviewed are read-only from tools.",
    inputSchema: object({ id }, ["id"]),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "instructions_get",
    description:
      "Read the user's shared instructions (Settings → Instructions): allChats, which is part of the prompt of every chat and every task-agent run; taskCreation, agentCreation and automationCreation, which task_context returns as promptGuidance; and taskExecution, which is part of every task-agent run's prompt. Returns each field's text and length, the current revision to pass to instructions_update, and the triggerRules, which are server behavior and not editable. With projectId: that project's additions to the four task fields, which are added after the global texts for tasks in that project (empty until written), their own revision, and the global texts for context.",
    inputSchema: object({ projectId: instructionsProjectId }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "instructions_update",
    description: `Replace the whole text of one shared instructions field. Call instructions_get first and pass its revision as expectedRevision; if the instructions changed since, the write is refused: read again and redo the edit on the current text. Integrate the user's request into the right field: keep the existing text, add or change only what was asked, keep it concise, and do not rewrite unrelated parts. allChats is in every chat and every task-agent run, and taskExecution in every run: keep both short, put task-only rules in the task fields, and tell the user when one grows large. When the rule concerns one project ("in this project…", or it names a project), write it to that project with its projectId (from task_context) and the revision from instructions_get with the same projectId: it is added after the global text for that project's tasks only. Otherwise edit the global fields without projectId. Rules for one specific agent belong in that agent's instructions (agent_update); rules about a repository's code belong in its AGENTS.md. reason says why, in a few words. After writing, tell the user in one or two lines what was added or changed and in which field; instructions_revert undoes it. ${INSTRUCTIONS_WRITE_ACCESS}`,
    inputSchema: object(
      {
        projectId: instructionsProjectId,
        field: instructionField,
        text: { type: "string" },
        reason: id,
        expectedRevision: { type: "integer", minimum: 0 },
      },
      ["field", "text", "reason", "expectedRevision"],
    ),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "read",
    name: "instructions_history",
    description:
      "List recent changes to the shared instructions, including allChats, newest first: change id, field, previous and new text, reason, source (the settings page, or the thread and task-agent run that made it) and time. Pass a change id to instructions_revert to undo it. Without projectId the global changes, with it that project's.",
    inputSchema: object({
      projectId: instructionsProjectId,
      field: instructionField,
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }),
  },
  {
    type: "function",
    namespace: "upcomputer_tasks",
    mutation: "write",
    name: "instructions_revert",
    description: `Undo one shared instructions change: restore the field's text from before it. The restore is recorded as a new change; history is never deleted. Refused when the field changed after that change: revert the later changes first, newest first, or use instructions_update. Tell the user in one line what was restored and in which field. Pass the projectId of a project's change, as in instructions_history. ${INSTRUCTIONS_WRITE_ACCESS}`,
    inputSchema: object({ projectId: instructionsProjectId, changeId: id, reason: id }, [
      "changeId",
    ]),
  },
];
