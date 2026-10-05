import { lazy, Suspense } from "react";
import { BotIcon, CalendarClockIcon, ListTodoIcon, MessageSquareTextIcon } from "lucide-react";

// The pure host module, not the web extension API: the product entry imports
// this file while the connection runtime is still initializing, so nothing here
// may reach web state at module load. The UI below loads on first render.
import {
  defineExperimentalWebFeature,
  type ExperimentalWebThreadAccessoryProps,
  type ExperimentalWebThreadRowAccessoryProps,
} from "../../../apps/web/src/product/WebFeature.ts";
import { TasksWebRpcGroup } from "./rpc/tasksRpcGroup.ts";

const LazyNavigationRunCounts = lazy(() =>
  import("./ui/TaskNavigationRunCounts.tsx").then((module) => ({
    default: module.TaskNavigationRunCounts,
  })),
);
const LazyThreadRunCounts = lazy(() =>
  import("./ui/TaskThreadRunCounts.tsx").then((module) => ({
    default: module.TaskThreadRunCounts,
  })),
);

function NavigationRunCounts() {
  return (
    <Suspense fallback={null}>
      <LazyNavigationRunCounts />
    </Suspense>
  );
}

function ThreadRowRunCounts(props: ExperimentalWebThreadRowAccessoryProps) {
  return (
    <Suspense fallback={props.fallback}>
      <LazyThreadRunCounts {...props} />
    </Suspense>
  );
}

/** The open chat's run counts after its title; nothing while it has none. */
function ChatHeaderRunCounts(props: ExperimentalWebThreadAccessoryProps) {
  return (
    <Suspense fallback={null}>
      <LazyThreadRunCounts {...props} fallback={null} />
    </Suspense>
  );
}

/**
 * Trusted build-time registration for the bundled first-party Tasks UI. Each
 * environment shows it once its server answers the Tasks RPC group.
 */
export const TASKS_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.tasks.web",
  version: 1,
  rpcGroups: [TasksWebRpcGroup],
  threadRowAccessory: ThreadRowRunCounts,
  chatHeaderAccessory: ChatHeaderRunCounts,
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
      accessory: NavigationRunCounts,
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
