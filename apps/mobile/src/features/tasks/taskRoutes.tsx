import { createNativeStackScreen } from "@react-navigation/native-stack";

import { pageRoute, sheetRoute } from "../layout/route-options";
import { TaskCreateScreen } from "./TaskCreateScreen";
import { TaskRouteScreen } from "./TaskRouteScreen";

/** Up.computer's task pages on the root stack, beside the workspace's other detail pages. */
export const TASK_SCREENS = {
  Task: createNativeStackScreen({
    screen: TaskRouteScreen,
    linking: "tasks/:environmentId/:taskId",
    options: pageRoute({ duoMinimize: "never" }),
  }),
  TaskCreate: createNativeStackScreen({
    screen: TaskCreateScreen,
    options: sheetRoute({ detent: 0.75, androidFit: true }),
  }),
};
