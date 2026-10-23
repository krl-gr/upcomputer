import { UpdateDefaultFirstMessageEventsPromptsMigration } from "./032_UpdateDefaultFirstMessageEventsPrompts.ts";
import { BotAppearanceMigration } from "./034_BotAppearance.ts";
import { BotMemoryProposalsMigration } from "./035_BotMemoryProposals.ts";
import { TasksNewestFirstMigration } from "./031_TasksNewestFirst.ts";
import { BotsMigration } from "./033_Bots.ts";
import { UpdateDefaultFeedOrderPromptsMigration } from "./030_UpdateDefaultFeedOrderPrompts.ts";
import { UpdateDefaultQueueStatePromptsMigration } from "./029_UpdateDefaultQueueStatePrompts.ts";
import { UpdateDefaultBatchCreatePromptsMigration } from "./028_UpdateDefaultBatchCreatePrompts.ts";
import { UpdateDefaultBlockedReleasePromptsMigration } from "./027_UpdateDefaultBlockedReleasePrompts.ts";
import { UpdateDefaultRunStartPromptsMigration } from "./026_UpdateDefaultRunStartPrompts.ts";
import { UpdateDefaultQueuePromptsMigration } from "./025_UpdateDefaultQueuePrompts.ts";
import { TaskAutomationRankMigration } from "./024_TaskAutomationRank.ts";
import { TaskScheduleRemindersMigration } from "./023_TaskScheduleReminders.ts";
import { TaskSettingsMigration } from "./022_TaskSettings.ts";
import { TaskScheduleEntriesMigration } from "./021_TaskScheduleEntries.ts";
import { TaskAudienceAndKindMigration } from "./020_TaskAudienceAndKind.ts";
import { TaskArchiveMigration } from "./019_TaskArchive.ts";
import { TaskSourceWakeBatchesMigration } from "./018_TaskSourceWakeBatches.ts";
import { TaskAgentRunSourceWakeMigration } from "./017_TaskAgentRunSourceWake.ts";
import { ProjectTaskPromptsMigration } from "./016_ProjectTaskPrompts.ts";
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
    { version: 16, name: "ProjectTaskPrompts", run: ProjectTaskPromptsMigration },
    { version: 17, name: "TaskAgentRunSourceWake", run: TaskAgentRunSourceWakeMigration },
    { version: 18, name: "TaskSourceWakeBatches", run: TaskSourceWakeBatchesMigration },
    { version: 19, name: "TaskArchive", run: TaskArchiveMigration },
    { version: 20, name: "TaskAudienceAndKind", run: TaskAudienceAndKindMigration },
    { version: 21, name: "TaskScheduleEntries", run: TaskScheduleEntriesMigration },
    { version: 22, name: "TaskSettings", run: TaskSettingsMigration },
    { version: 23, name: "TaskScheduleReminders", run: TaskScheduleRemindersMigration },
    { version: 24, name: "TaskAutomationRank", run: TaskAutomationRankMigration },
    { version: 25, name: "UpdateDefaultQueuePrompts", run: UpdateDefaultQueuePromptsMigration },
    {
      version: 26,
      name: "UpdateDefaultRunStartPrompts",
      run: UpdateDefaultRunStartPromptsMigration,
    },
    {
      version: 27,
      name: "UpdateDefaultBlockedReleasePrompts",
      run: UpdateDefaultBlockedReleasePromptsMigration,
    },
    {
      version: 28,
      name: "UpdateDefaultBatchCreatePrompts",
      run: UpdateDefaultBatchCreatePromptsMigration,
    },
    {
      version: 29,
      name: "UpdateDefaultQueueStatePrompts",
      run: UpdateDefaultQueueStatePromptsMigration,
    },
    {
      version: 30,
      name: "UpdateDefaultFeedOrderPrompts",
      run: UpdateDefaultFeedOrderPromptsMigration,
    },
    { version: 31, name: "TasksNewestFirst", run: TasksNewestFirstMigration },
    {
      version: 32,
      name: "UpdateDefaultFirstMessageEventsPrompts",
      run: UpdateDefaultFirstMessageEventsPromptsMigration,
    },
    { version: 33, name: "Bots", run: BotsMigration },
    { version: 34, name: "BotAppearance", run: BotAppearanceMigration },
    { version: 35, name: "BotMemoryProposals", run: BotMemoryProposalsMigration },
  ],
} as const;
