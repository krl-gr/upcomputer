import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { use } from "react";

import { usePaneRole } from "../../components/ui/Pane";
import { Toolbar } from "../../components/ui/Toolbar";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useWorkspaceState } from "../../state/workspace";
import { AutomationsView } from "./automations/AutomationsView";
import { PlannerView } from "./planner/PlannerView";
import { chooseTasksEnvironment, tasksEnvironments } from "./taskListState";
import { updateTasksPreferences, useTasksPreferences } from "./tasksPreferences";
import { WorkerTasksView } from "./WorkerTasksView";

/**
 * The Tasks tab: the desktop's four Tasks views for one computer. The header's menu picks the
 * view and holds its filters or list options; the phone remembers the choice.
 */
export function TasksScreen(props: { readonly sidebar?: boolean } = {}) {
  const gt = useGT();
  const primaryColumn = use(NativePrimaryColumnContext);
  const { environments } = useWorkspaceState();
  const preferences = useTasksPreferences();
  const choices = tasksEnvironments(environments);
  const environmentId = chooseTasksEnvironment(
    choices,
    preferences.environmentId as EnvironmentId | null,
  );
  const environment = choices.find((choice) => choice.environmentId === environmentId) ?? null;
  const connected = environment?.connectionState === "connected";
  const paneRole = usePaneRole();
  const sidebar = props.sidebar === true || (primaryColumn !== null && paneRole === "sidebar");
  // The desktop's Environment choice, in the header menu when there is more than one computer.
  const environmentMenu =
    choices.length > 1 ? (
      <Toolbar.Menu title={gt("Environment")} icon="desktopcomputer">
        {choices.map((choice) => (
          <Toolbar.MenuAction
            key={choice.environmentId}
            isOn={choice.environmentId === environmentId}
            subtitle={choice.connectionState === "connected" ? undefined : gt("Offline")}
            onPress={() => updateTasksPreferences({ environmentId: choice.environmentId })}
          >
            {choice.environmentLabel}
          </Toolbar.MenuAction>
        ))}
      </Toolbar.Menu>
    ) : null;
  const shared = { environmentId, connected, sidebar, environmentMenu };
  switch (preferences.view) {
    case "automations":
      return <AutomationsView {...shared} environment={environment} />;
    case "mine":
    case "routines":
      return <PlannerView {...shared} view={preferences.view} />;
    case "workers":
      return <WorkerTasksView {...shared} environment={environment} />;
  }
}
