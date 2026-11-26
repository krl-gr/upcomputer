import { createNativeStackScreen } from "@react-navigation/native-stack";

import { BotMemoryScreen } from "../bots/BotMemoryScreen";
import { pageRoute, sheetRoute } from "../layout/route-options";
import { AutomationRouteScreen } from "./automations/AutomationRouteScreen";
import { TaskCreateScreen } from "./TaskCreateScreen";
import { TaskRouteScreen } from "./TaskRouteScreen";
import { WorkersScreen } from "../workers/WorkersScreen";

/** Up.computer's task and bot pages on the root stack, beside the workspace's other detail pages. */
export const TASK_SCREENS = {
  Task: createNativeStackScreen({
    screen: TaskRouteScreen,
    linking: "tasks/:environmentId/:taskId",
    options: pageRoute({ duoMinimize: "never" }),
  }),
  Automation: createNativeStackScreen({
    screen: AutomationRouteScreen,
    linking: "automations/:environmentId/:automationId",
    options: pageRoute({ duoMinimize: "never" }),
  }),
  TaskCreate: createNativeStackScreen({
    screen: TaskCreateScreen,
    options: sheetRoute({ detent: 0.75, androidFit: true }),
  }),
  Workers: createNativeStackScreen({
    screen: WorkersScreen,
    linking: "workers",
    options: pageRoute({ duoMinimize: "never" }),
  }),
  BotMemory: createNativeStackScreen({
    screen: BotMemoryScreen,
    options: sheetRoute({ detent: 0.75, androidFit: true }),
  }),
};
