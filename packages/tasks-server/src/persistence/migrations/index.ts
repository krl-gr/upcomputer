import { UpdateDefaultTaskPromptsMigration } from "./015_UpdateDefaultTaskPrompts.ts";
import { TaskPromptSettingsHistoryMigration } from "./014_TaskPromptSettingsHistory.ts";
import { TaskAgentRunContinuationMigration } from "./013_TaskAgentRunContinuation.ts";
import { TaskTriggerSemanticsMigration } from "./012_TaskTriggerSemantics.ts";
import { TaskOriginsMigration } from "./011_TaskOrigins.ts";
import { NarrowTaskListRevisionMigration } from "./010_NarrowTaskListRevision.ts";
import { TaskListRevisionMigration } from "./009_TaskListRevision.ts";
import { CreateTaskStorageMigration } from "./001_CreateTaskStorage.ts";
import { CreateTaskAgentStorageMigration } from "./002_CreateTaskAgentStorage.ts";
import { ImportLegacyTaskAgentsMigration } from "./003_ImportLegacyTaskAgents.ts";
import { CreateTaskAutomationStorageMigration } from "./004_CreateTaskAutomationStorage.ts";
import { BackfillTaskAgentThreadVisibilityMigration } from "./005_BackfillTaskAgentThreadVisibility.ts";
import { AddTaskOutputMigration } from "./006_AddTaskOutput.ts";
import { CreateTaskPromptSettingsMigration } from "./007_CreateTaskPromptSettings.ts";
import { AddGlobalTaskRankMigration } from "./008_AddGlobalTaskRank.ts";

const TASK_MIGRATION_OWNER_ID = "upcomputer.tasks" as const;
const TASK_MIGRATION_NAMESPACE = "upcomputer.tasks" as const;

export const TASK_MIGRATION_CONTRIBUTION = {
  ownerId: TASK_MIGRATION_OWNER_ID,
  namespace: TASK_MIGRATION_NAMESPACE,
  migrations: [
    {
      version: 1,
      name: "CreateTaskStorage",
      run: CreateTaskStorageMigration,
    },
    {
      version: 2,
      name: "CreateTaskAgentStorage",
      run: CreateTaskAgentStorageMigration,
    },
    {
      version: 3,
      name: "ImportLegacyTaskAgents",
      run: ImportLegacyTaskAgentsMigration,
    },
    {
      version: 4,
      name: "CreateTaskAutomationStorage",
      run: CreateTaskAutomationStorageMigration,
    },
    {
      version: 5,
      name: "BackfillTaskAgentThreadVisibility",
      run: BackfillTaskAgentThreadVisibilityMigration,
    },
    {
      version: 6,
      name: "AddTaskOutput",
      run: AddTaskOutputMigration,
    },
    {
      version: 7,
      name: "CreateTaskPromptSettings",
      run: CreateTaskPromptSettingsMigration,
    },
    {
      version: 8,
      name: "AddGlobalTaskRank",
      run: AddGlobalTaskRankMigration,
    },
    { version: 9, name: "TaskListRevision", run: TaskListRevisionMigration },
    { version: 10, name: "NarrowTaskListRevision", run: NarrowTaskListRevisionMigration },
    { version: 11, name: "TaskOrigins", run: TaskOriginsMigration },
    { version: 12, name: "TaskTriggerSemantics", run: TaskTriggerSemanticsMigration },
    { version: 13, name: "TaskAgentRunContinuation", run: TaskAgentRunContinuationMigration },
    { version: 14, name: "TaskPromptSettingsHistory", run: TaskPromptSettingsHistoryMigration },
    { version: 15, name: "UpdateDefaultTaskPrompts", run: UpdateDefaultTaskPromptsMigration },
  ],
} as const;
