import { lazy, Suspense } from "react";
import { BotIcon, ListTodoIcon, MessageSquareTextIcon } from "lucide-react";

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
const LazyTaskReminderNotifications = lazy(() =>
  import("./planner/reminders/TaskReminderNotifications.tsx").then((module) => ({
    default: module.TaskReminderNotifications,
  })),
);
const LazyThreadRunCounts = lazy(() =>
  import("./ui/TaskThreadRunCounts.tsx").then((module) => ({
    default: module.TaskThreadRunCounts,
  })),
);
// The thread menu asks synchronously, so its bot module loads with the Bots section, which
// every sidebar shows. Until then the menu simply has no bot entry.
let botMenu: typeof import("./bots/botMenu.ts") | undefined;
const LazySidebarBots = lazy(() =>
  Promise.all([import("./bots/Bots.tsx"), import("./bots/botMenu.ts")]).then(([bots, menu]) => {
    botMenu = menu;
    return { default: bots.SidebarBots };
  }),
);
const LazyCompactSidebarBots = lazy(() =>
  import("./bots/Bots.tsx").then((module) => ({ default: module.CompactSidebarBots })),
);
const LazyBotHeader = lazy(() =>
  import("./bots/Bots.tsx").then((module) => ({ default: module.BotHeader })),
);

function SidebarBots() {
  return (
    <Suspense fallback={null}>
      <LazySidebarBots />
    </Suspense>
  );
}

function CompactSidebarBots() {
  return (
    <Suspense fallback={null}>
      <LazyCompactSidebarBots />
    </Suspense>
  );
}

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

/** Task reminders as toasts and system notifications, wherever the app is. */
function TaskReminders() {
  return (
    <Suspense fallback={null}>
      <LazyTaskReminderNotifications />
    </Suspense>
  );
}

/** The open chat's run counts after its title; nothing while it has none. */
function ChatHeaderRunCounts(props: ExperimentalWebThreadAccessoryProps) {
  return (
    <Suspense fallback={null}>
      <LazyThreadRunCounts {...props} fallback={null} />
      <LazyBotHeader {...props} />
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
  threadActions: (thread) => botMenu?.botThreadActions(thread) ?? [],
  sidebarSection: SidebarBots,
  compactSidebarSection: CompactSidebarBots,
  coordinator: TaskReminders,
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
  rightPanelSurfaces: [
    {
      id: "tasks",
      label: "Tasks",
      shortcut: "K",
      icon: ListTodoIcon,
      load: () => import("./ui/TasksPanel.tsx"),
    },
  ],
  routes: [
    { id: "tasks", path: "/tasks", load: () => import("./ui/TasksRoute.tsx") },
    { id: "agents", path: "/agents", load: () => import("./ui/AgentsRoute.tsx") },
    { id: "bots", path: "/bots", load: () => import("./bots/BotPage.tsx") },
    // Automations live on the Agents side of Tasks; old links redirect there.
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
  ],
});
