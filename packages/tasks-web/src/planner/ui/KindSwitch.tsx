import { useGT } from "gt-react";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { PlannerKind } from "../data/preferences.ts";

const kindOf = (value: unknown) => (value === "task" || value === "routine" ? value : null);

/**
 * Tasks / Routines: wande's two tabs, what the planner lists. Sits in the
 * list header right of the Me / Workers switch.
 */
export function KindSwitch(props: {
  readonly value: PlannerKind;
  readonly onChange: (kind: PlannerKind) => void;
}) {
  const gt = useGT();
  return (
    <ToggleGroup
      aria-label={gt("Tasks or routines")}
      variant="segmented-outline"
      value={[props.value]}
      onValueChange={(value) => {
        const next = kindOf(value[0]);
        if (next) props.onChange(next);
      }}
    >
      <ToggleGroupItem value="task">{gt("Tasks")}</ToggleGroupItem>
      <ToggleGroupItem value="routine">{gt("Routines")}</ToggleGroupItem>
    </ToggleGroup>
  );
}
