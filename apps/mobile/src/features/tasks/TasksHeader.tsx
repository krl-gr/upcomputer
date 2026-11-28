import { msg, useMessages } from "gt-react-native";
import type { ReactNode } from "react";
import { Platform } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Toolbar } from "../../components/ui/Toolbar";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { useControlTheme } from "../../components/ui/useControlTheme";
import {
  HIDDEN_TASKS_VIEWS,
  updateTasksPreferences,
  useTasksPreferences,
  type TasksView,
} from "./tasksPreferences";

/** The four views, in the desktop's names. */
const ALL_TASKS_VIEWS: ReadonlyArray<{ readonly view: TasksView; readonly title: string }> = [
  { view: "workers", title: msg("Worker tasks") },
  { view: "automations", title: msg("Automations") },
  { view: "mine", title: msg("My tasks") },
  { view: "routines", title: msg("My routines") },
];
export const TASKS_VIEWS = ALL_TASKS_VIEWS.filter(
  (entry) => !HIDDEN_TASKS_VIEWS.includes(entry.view),
);

/** The chosen view's name, for the native header title like every other tab's. */
export function useTasksHeaderTitle() {
  const messages = useMessages();
  const { view } = useTasksPreferences();
  return messages(TASKS_VIEWS.find((entry) => entry.view === view)?.title ?? TASKS_VIEWS[0]!.title);
}

function TasksHeaderTitle() {
  const messages = useMessages();
  const { scale } = useAndroidControlSizing();
  const { view } = useTasksPreferences();
  const title = TASKS_VIEWS.find((entry) => entry.view === view)?.title ?? TASKS_VIEWS[0]!.title;
  return (
    <Text
      accessibilityRole="header"
      allowFontScaling={Platform.OS === "ios"}
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
      className="font-t3-bold text-foreground"
      style={{ fontSize: 20 * scale, letterSpacing: -0.4 * scale }}
    >
      {messages(title)}
    </Text>
  );
}

/** The Tasks tab's header title: the chosen view's name. */
export function renderTasksHeaderTitle() {
  return <TasksHeaderTitle />;
}

/**
 * The Tasks tab's header buttons: + and one menu that picks the view and holds its filters or
 * list options, as the desktop's header does at narrow width. `sections` are menu items: build
 * them from `Toolbar.Menu` and `Toolbar.MenuAction` elements, not components.
 */
export function TasksToolbar(props: {
  readonly createLabel: string;
  readonly createDisabled: boolean;
  readonly onCreate: () => void;
  readonly menuLabel: string;
  /** Filters differ from their defaults: the button shows it, as the desktop's count does. */
  readonly applied: boolean;
  readonly sections?: ReactNode;
}) {
  const messages = useMessages();
  const { view } = useTasksPreferences();
  const tint = useControlTheme().colors["--color-primary"];
  // UIKit lays trailing items out from the edge inward: the menu sits in the corner.
  return (
    <Toolbar placement="right">
      <Toolbar.Menu
        identifier="tasks-view-menu"
        accessibilityLabel={props.menuLabel}
        icon="up.sliders"
        tintColor={props.applied ? tint : undefined}
      >
        <Toolbar.Menu inline title="">
          {TASKS_VIEWS.map((entry) => (
            <Toolbar.MenuAction
              key={entry.view}
              isOn={entry.view === view}
              onPress={() => updateTasksPreferences({ view: entry.view })}
            >
              {messages(entry.title)}
            </Toolbar.MenuAction>
          ))}
        </Toolbar.Menu>
        {props.sections}
      </Toolbar.Menu>
      <Toolbar.Button
        identifier="tasks-create"
        accessibilityLabel={props.createLabel}
        icon="up.plus"
        disabled={props.createDisabled}
        onPress={props.onCreate}
      />
    </Toolbar>
  );
}
