import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { PlannerKind } from "../data/preferences.ts";

/**
 * Tasks / Routines: wande's two tabs, what the planner lists. Sits in the
 * toolbar left of Mine / Agents / All, its other axis.
 */
export function KindSwitch(props: {
  readonly value: PlannerKind;
  readonly onChange: (kind: PlannerKind) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Tasks or routines"
      variant="segmented-outline"
      value={[props.value]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "task" || next === "routine") props.onChange(next);
      }}
    >
      <ToggleGroupItem value="task">Tasks</ToggleGroupItem>
      <ToggleGroupItem value="routine">Routines</ToggleGroupItem>
    </ToggleGroup>
  );
}
