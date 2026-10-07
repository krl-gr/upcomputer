import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { TasksViewMode } from "../data/preferences.ts";

/** Planner or Table, at the left of the /tasks header. */
export function TasksViewSwitch(props: {
  readonly value: TasksViewMode;
  readonly onChange: (value: TasksViewMode) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Tasks view"
      variant="segmented-outline"
      value={[props.value]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "planner" || next === "table") props.onChange(next);
      }}
    >
      <ToggleGroupItem value="planner">Planner</ToggleGroupItem>
      <ToggleGroupItem value="table">Table</ToggleGroupItem>
    </ToggleGroup>
  );
}
