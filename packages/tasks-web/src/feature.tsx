import { TaskNavigationRunCounts } from "./ui/TaskNavigationRunCounts.tsx";
import { TaskThreadRunCounts } from "./ui/TaskThreadRunCounts.tsx";
import { BotIcon, CalendarClockIcon, ListTodoIcon, MessageSquareTextIcon } from "lucide-react";
import {
  TASK_AGENTS_RPC_CAPABILITY_ID,
  TASK_AGENTS_RPC_CONTRACT_VERSION,
  TASK_AUTOMATIONS_RPC_CAPABILITY_ID,
  TASK_AUTOMATIONS_RPC_CONTRACT_VERSION,
  TASKS_RPC_CAPABILITY_ID,
  TASKS_RPC_CONTRACT_VERSION,
} from "@upcomputer/tasks-contracts/v1";

import { defineExperimentalWebFeature } from "../../../apps/web/src/extensionApi.ts";

export { TASKS_WEB_ENVIRONMENT_API, TASKS_WEB_ENVIRONMENT_API_FACTORY } from "./environmentApi.ts";

const exactPrivateCapability = (id: string, version: number) =>
  ({
    id,
    minimum: version,
    maximum: version,
    ownerId: "upcomputer.tasks",
  }) as const;

/** Trusted build-time registration for the bundled first-party Tasks UI. */
export const TASKS_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.tasks.web",
  ownerId: "upcomputer.tasks",
  extensionId: "upcomputer.tasks",
  version: 1,
  threadAccessory: {
    component: TaskThreadRunCounts,
    capabilities: [exactPrivateCapability(TASKS_RPC_CAPABILITY_ID, TASKS_RPC_CONTRACT_VERSION)],
  },
  settings: [
    {
      id: "instructions",
      label: "Instructions",
      path: "/settings/instructions",
      order: 40,
      icon: MessageSquareTextIcon,
      load: () => import("./settings/InstructionsSettingsPage.tsx"),
    },
  ],
  routes: [
    {
      id: "tasks",
      path: "/tasks",
      capabilities: [exactPrivateCapability(TASKS_RPC_CAPABILITY_ID, TASKS_RPC_CONTRACT_VERSION)],
      load: () => import("./ui/TasksRoute.tsx"),
    },
    {
      id: "agents",
      path: "/agents",
      capabilities: [
        exactPrivateCapability(TASKS_RPC_CAPABILITY_ID, TASKS_RPC_CONTRACT_VERSION),
        exactPrivateCapability(TASK_AGENTS_RPC_CAPABILITY_ID, TASK_AGENTS_RPC_CONTRACT_VERSION),
      ],
      load: () => import("./ui/AgentsRoute.tsx"),
    },
    {
      id: "automations",
      path: "/automations",
      capabilities: [
        exactPrivateCapability(TASKS_RPC_CAPABILITY_ID, TASKS_RPC_CONTRACT_VERSION),
        exactPrivateCapability(
          TASK_AUTOMATIONS_RPC_CAPABILITY_ID,
          TASK_AUTOMATIONS_RPC_CONTRACT_VERSION,
        ),
      ],
      load: () => import("./ui/AutomationsRoute.tsx"),
    },
  ],
  navigation: [
    {
      id: "tasks",
      label: "Tasks",
      path: "/tasks",
      slot: "primary-after-project",
      order: 20,
      icon: ListTodoIcon,
      accessory: TaskNavigationRunCounts,
      capabilities: [exactPrivateCapability(TASKS_RPC_CAPABILITY_ID, TASKS_RPC_CONTRACT_VERSION)],
    },
    {
      id: "agents",
      label: "Agents",
      path: "/agents",
      slot: "primary-after-project",
      order: 30,
      icon: BotIcon,
      capabilities: [
        exactPrivateCapability(TASKS_RPC_CAPABILITY_ID, TASKS_RPC_CONTRACT_VERSION),
        exactPrivateCapability(TASK_AGENTS_RPC_CAPABILITY_ID, TASK_AGENTS_RPC_CONTRACT_VERSION),
      ],
    },
    {
      id: "automations",
      label: "Automations",
      path: "/automations",
      slot: "primary-after-project",
      order: 40,
      icon: CalendarClockIcon,
      capabilities: [
        exactPrivateCapability(TASKS_RPC_CAPABILITY_ID, TASKS_RPC_CONTRACT_VERSION),
        exactPrivateCapability(
          TASK_AUTOMATIONS_RPC_CAPABILITY_ID,
          TASK_AUTOMATIONS_RPC_CONTRACT_VERSION,
        ),
      ],
    },
  ],
});
