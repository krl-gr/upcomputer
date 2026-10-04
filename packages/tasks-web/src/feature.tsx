import { BotIcon, CalendarClockIcon, ListTodoIcon, MessageSquareTextIcon } from "lucide-react";

import { defineExperimentalWebFeature } from "../../../apps/web/src/extensionApi.ts";
import { TasksWebRpcGroup } from "./rpc/index.ts";
import { TaskNavigationRunCounts } from "./ui/TaskNavigationRunCounts.tsx";
import { TaskChatHeaderRunCounts, TaskThreadRunCounts } from "./ui/TaskThreadRunCounts.tsx";

export {
  readTasksWebAccess,
  readTasksWebClient,
  useTasksWebAccessRevision,
} from "./environmentApi.ts";

/**
 * Trusted build-time registration for the bundled first-party Tasks UI. Each
 * environment shows it once its server answers the Tasks RPC group.
 */
export const TASKS_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.tasks.web",
  version: 1,
  rpcGroups: [TasksWebRpcGroup],
  threadRowAccessory: TaskThreadRunCounts,
  chatHeaderAccessory: TaskChatHeaderRunCounts,
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
    { id: "tasks", path: "/tasks", load: () => import("./ui/TasksRoute.tsx") },
    { id: "agents", path: "/agents", load: () => import("./ui/AgentsRoute.tsx") },
    { id: "automations", path: "/automations", load: () => import("./ui/AutomationsRoute.tsx") },
  ],
  navigation: [
    {
      id: "tasks",
      label: "Tasks",
      path: "/tasks",
      order: 20,
      icon: ListTodoIcon,
      accessory: TaskNavigationRunCounts,
    },
    { id: "agents", label: "Agents", path: "/agents", order: 30, icon: BotIcon },
    {
      id: "automations",
      label: "Automations",
      path: "/automations",
      order: 40,
      icon: CalendarClockIcon,
    },
  ],
});
