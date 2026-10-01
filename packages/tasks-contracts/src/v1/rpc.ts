import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  TaskAgent,
  TaskAgentDeleteInput,
  TaskAgentRunSearchInput,
  TaskAgentRunSearchResult,
  TaskAgentSearchInput,
  TaskAgentSearchResult,
  TaskAgentUpsertInput,
} from "./agents.ts";
import {
  AutomationDeleteInput,
  TaskAutomation,
  TaskAutomationRunSearchInput,
  TaskAutomationRunSearchResult,
  TaskAutomationSearchInput,
  TaskAutomationSearchResult,
  TaskAutomationSetStatusInput,
  TaskAutomationUpsertInput,
} from "./automations.ts";
import {
  TaskPromptSettings,
  TaskPromptSettingsGetInput,
  TaskPromptSettingsUpdateInput,
  TaskPromptSettingsUpdateResult,
} from "./prompts.ts";
import {
  Task,
  TaskAppendEventInput,
  TaskCreateInput,
  TaskDeleteInput,
  TaskError,
  TaskEvent,
  TaskReorderInput,
  TaskGetInput,
  TaskPageInput,
  TaskPageResult,
  TaskListItemsInput,
  TaskListItemsResult,
  TaskChange,
  TaskRunCountsInput,
  TaskRunCountsResult,
  TaskThreadRunCountsInput,
  TaskThreadRunCountsResult,
  TaskThreadTasksInput,
  TaskThreadTasksResult,
  TaskSearchInput,
  TaskSearchResult,
  TaskTagInput,
  TaskUpdateInput,
} from "./tasks.ts";

export const TASKS_RPC_CONTRACT_VERSION = 10 as const;
export const TASKS_RPC_NAMESPACE = "upcomputer.tasks.v1" as const;
export const TASKS_RPC_CAPABILITY_ID = "upcomputer.tasks.rpc.v1" as const;
export const TASKS_RPC_CAPABILITY = {
  id: TASKS_RPC_CAPABILITY_ID,
  version: TASKS_RPC_CONTRACT_VERSION,
} as const;

export const TASK_AGENTS_RPC_CONTRACT_VERSION = 4 as const;
export const TASK_AGENTS_RPC_NAMESPACE = "upcomputer.task-agents.v1" as const;
export const TASK_AGENTS_RPC_CAPABILITY_ID = "upcomputer.task-agents.rpc.v1" as const;
export const TASK_AGENTS_RPC_CAPABILITY = {
  id: TASK_AGENTS_RPC_CAPABILITY_ID,
  version: TASK_AGENTS_RPC_CONTRACT_VERSION,
} as const;

export const TASK_AUTOMATIONS_RPC_CONTRACT_VERSION = 1 as const;
export const TASK_AUTOMATIONS_RPC_NAMESPACE = "upcomputer.task-automations.v1" as const;
export const TASK_AUTOMATIONS_RPC_CAPABILITY_ID = "upcomputer.task-automations.rpc.v1" as const;
export const TASK_AUTOMATIONS_RPC_CAPABILITY = {
  id: TASK_AUTOMATIONS_RPC_CAPABILITY_ID,
  version: TASK_AUTOMATIONS_RPC_CONTRACT_VERSION,
} as const;

export const TASKS_RPC_METHODS = {
  create: `${TASKS_RPC_NAMESPACE}.create`,
  search: `${TASKS_RPC_NAMESPACE}.search`,
  page: `${TASKS_RPC_NAMESPACE}.page`,
  items: `${TASKS_RPC_NAMESPACE}.items`,
  runCounts: `${TASKS_RPC_NAMESPACE}.runCounts`,
  threadRunCounts: `${TASKS_RPC_NAMESPACE}.threadRunCounts`,
  threadTasks: `${TASKS_RPC_NAMESPACE}.threadTasks`,
  subscribe: `${TASKS_RPC_NAMESPACE}.subscribe`,
  get: `${TASKS_RPC_NAMESPACE}.get`,
  update: `${TASKS_RPC_NAMESPACE}.update`,
  reorder: `${TASKS_RPC_NAMESPACE}.reorder`,
  delete: `${TASKS_RPC_NAMESPACE}.delete`,
  addTag: `${TASKS_RPC_NAMESPACE}.addTag`,
  removeTag: `${TASKS_RPC_NAMESPACE}.removeTag`,
  appendEvent: `${TASKS_RPC_NAMESPACE}.appendEvent`,
  getPromptSettings: `${TASKS_RPC_NAMESPACE}.getPromptSettings`,
  updatePromptSettings: `${TASKS_RPC_NAMESPACE}.updatePromptSettings`,
} as const;

export const TASK_AGENTS_RPC_METHODS = {
  upsert: `${TASK_AGENTS_RPC_NAMESPACE}.upsert`,
  search: `${TASK_AGENTS_RPC_NAMESPACE}.search`,
  delete: `${TASK_AGENTS_RPC_NAMESPACE}.delete`,
  searchRuns: `${TASK_AGENTS_RPC_NAMESPACE}.searchRuns`,
} as const;

export const TASK_AUTOMATIONS_RPC_METHODS = {
  upsert: `${TASK_AUTOMATIONS_RPC_NAMESPACE}.upsert`,
  search: `${TASK_AUTOMATIONS_RPC_NAMESPACE}.search`,
  setStatus: `${TASK_AUTOMATIONS_RPC_NAMESPACE}.setStatus`,
  delete: `${TASK_AUTOMATIONS_RPC_NAMESPACE}.delete`,
  searchRuns: `${TASK_AUTOMATIONS_RPC_NAMESPACE}.searchRuns`,
} as const;

export const TasksCreateRpc = Rpc.make(TASKS_RPC_METHODS.create, {
  payload: TaskCreateInput,
  success: Task,
  error: TaskError,
});
export const TasksSearchRpc = Rpc.make(TASKS_RPC_METHODS.search, {
  payload: TaskSearchInput,
  success: TaskSearchResult,
  error: TaskError,
});
export const TasksPageRpc = Rpc.make(TASKS_RPC_METHODS.page, {
  payload: TaskPageInput,
  success: TaskPageResult,
  error: TaskError,
});
export const TasksItemsRpc = Rpc.make(TASKS_RPC_METHODS.items, {
  payload: TaskListItemsInput,
  success: TaskListItemsResult,
  error: TaskError,
});
export const TasksSubscribeRpc = Rpc.make(TASKS_RPC_METHODS.subscribe, {
  payload: Schema.Struct({}),
  success: TaskChange,
  error: TaskError,
  stream: true,
});
export const TasksGetRpc = Rpc.make(TASKS_RPC_METHODS.get, {
  payload: TaskGetInput,
  success: Schema.NullOr(Task),
  error: TaskError,
});
export const TasksUpdateRpc = Rpc.make(TASKS_RPC_METHODS.update, {
  payload: TaskUpdateInput,
  success: Task,
  error: TaskError,
});
export const TasksReorderRpc = Rpc.make(TASKS_RPC_METHODS.reorder, {
  payload: TaskReorderInput,
  success: Task,
  error: TaskError,
});
export const TasksDeleteRpc = Rpc.make(TASKS_RPC_METHODS.delete, {
  payload: TaskDeleteInput,
  error: TaskError,
});
export const TasksAddTagRpc = Rpc.make(TASKS_RPC_METHODS.addTag, {
  payload: TaskTagInput,
  success: Task,
  error: TaskError,
});
export const TasksRemoveTagRpc = Rpc.make(TASKS_RPC_METHODS.removeTag, {
  payload: TaskTagInput,
  success: Task,
  error: TaskError,
});
export const TasksAppendEventRpc = Rpc.make(TASKS_RPC_METHODS.appendEvent, {
  payload: TaskAppendEventInput,
  success: TaskEvent,
  error: TaskError,
});
export const TasksGetPromptSettingsRpc = Rpc.make(TASKS_RPC_METHODS.getPromptSettings, {
  payload: TaskPromptSettingsGetInput,
  success: TaskPromptSettings,
  error: TaskError,
});
export const TasksUpdatePromptSettingsRpc = Rpc.make(TASKS_RPC_METHODS.updatePromptSettings, {
  payload: TaskPromptSettingsUpdateInput,
  success: TaskPromptSettingsUpdateResult,
  error: TaskError,
});

export const TasksRunCountsRpc = Rpc.make(TASKS_RPC_METHODS.runCounts, {
  payload: TaskRunCountsInput,
  success: TaskRunCountsResult,
  error: TaskError,
});

export const TasksThreadRunCountsRpc = Rpc.make(TASKS_RPC_METHODS.threadRunCounts, {
  payload: TaskThreadRunCountsInput,
  success: TaskThreadRunCountsResult,
  error: TaskError,
});

export const TasksThreadTasksRpc = Rpc.make(TASKS_RPC_METHODS.threadTasks, {
  payload: TaskThreadTasksInput,
  success: TaskThreadTasksResult,
  error: TaskError,
});

export const TasksRpcGroup = RpcGroup.make(
  TasksRunCountsRpc,
  TasksThreadRunCountsRpc,
  TasksThreadTasksRpc,
  TasksCreateRpc,
  TasksSearchRpc,
  TasksPageRpc,
  TasksItemsRpc,
  TasksSubscribeRpc,
  TasksGetRpc,
  TasksUpdateRpc,
  TasksReorderRpc,
  TasksDeleteRpc,
  TasksAddTagRpc,
  TasksRemoveTagRpc,
  TasksAppendEventRpc,
  TasksGetPromptSettingsRpc,
  TasksUpdatePromptSettingsRpc,
);

export const TaskAgentsUpsertRpc = Rpc.make(TASK_AGENTS_RPC_METHODS.upsert, {
  payload: TaskAgentUpsertInput,
  success: TaskAgent,
  error: TaskError,
});
export const TaskAgentsSearchRpc = Rpc.make(TASK_AGENTS_RPC_METHODS.search, {
  payload: TaskAgentSearchInput,
  success: TaskAgentSearchResult,
  error: TaskError,
});
export const TaskAgentsDeleteRpc = Rpc.make(TASK_AGENTS_RPC_METHODS.delete, {
  payload: TaskAgentDeleteInput,
  error: TaskError,
});
export const TaskAgentsSearchRunsRpc = Rpc.make(TASK_AGENTS_RPC_METHODS.searchRuns, {
  payload: TaskAgentRunSearchInput,
  success: TaskAgentRunSearchResult,
  error: TaskError,
});

export const TaskAgentsRpcGroup = RpcGroup.make(
  TaskAgentsUpsertRpc,
  TaskAgentsSearchRpc,
  TaskAgentsDeleteRpc,
  TaskAgentsSearchRunsRpc,
);

export const TaskAutomationsUpsertRpc = Rpc.make(TASK_AUTOMATIONS_RPC_METHODS.upsert, {
  payload: TaskAutomationUpsertInput,
  success: TaskAutomation,
  error: TaskError,
});
export const TaskAutomationsSearchRpc = Rpc.make(TASK_AUTOMATIONS_RPC_METHODS.search, {
  payload: TaskAutomationSearchInput,
  success: TaskAutomationSearchResult,
  error: TaskError,
});
export const TaskAutomationsSetStatusRpc = Rpc.make(TASK_AUTOMATIONS_RPC_METHODS.setStatus, {
  payload: TaskAutomationSetStatusInput,
  success: TaskAutomation,
  error: TaskError,
});
export const TaskAutomationsDeleteRpc = Rpc.make(TASK_AUTOMATIONS_RPC_METHODS.delete, {
  payload: AutomationDeleteInput,
  error: TaskError,
});
export const TaskAutomationsSearchRunsRpc = Rpc.make(TASK_AUTOMATIONS_RPC_METHODS.searchRuns, {
  payload: TaskAutomationRunSearchInput,
  success: TaskAutomationRunSearchResult,
  error: TaskError,
});

export const TaskAutomationsRpcGroup = RpcGroup.make(
  TaskAutomationsUpsertRpc,
  TaskAutomationsSearchRpc,
  TaskAutomationsSetStatusRpc,
  TaskAutomationsDeleteRpc,
  TaskAutomationsSearchRunsRpc,
);
