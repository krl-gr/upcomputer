import { ListTodoIcon, RepeatIcon } from "lucide-react";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { PlannerKind } from "../data/preferences.ts";
import { HeaderSwitchLabel } from "./HeaderSwitchLabel.tsx";

const LABELS: Record<PlannerKind, string> = { task: "Tasks", routine: "Routines" };

const kindOf = (value: unknown) => (value === "task" || value === "routine" ? value : null);

/**
 * Tasks / Routines: wande's two tabs, what the planner lists. Sits in the
 * list header right of the Me / Workers switch.
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
        const next = kindOf(value[0]);
        if (next) props.onChange(next);
      }}
    >
      <ToggleGroupItem value="task" aria-label={LABELS.task}>
        <HeaderSwitchLabel icon={ListTodoIcon} label={LABELS.task} compactBelow="listHeader" />
      </ToggleGroupItem>
      <ToggleGroupItem value="routine" aria-label={LABELS.routine}>
        <HeaderSwitchLabel icon={RepeatIcon} label={LABELS.routine} compactBelow="listHeader" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
