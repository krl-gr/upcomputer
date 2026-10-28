import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { TableSection } from "../planner/data/preferences.ts";

/**
 * Tasks / Automations: what the Agents side lists, beside the Me / Agents
 * switch. Automations are the agents' routines: each creates agent tasks on
 * a schedule, and those tasks show under Tasks.
 */
export function TableSectionSwitch(props: {
  readonly value: TableSection;
  readonly onChange: (section: TableSection) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Agent tasks or automations"
      variant="segmented-outline"
      value={[props.value]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "tasks" || next === "automations") props.onChange(next);
      }}
    >
      <ToggleGroupItem value="tasks" data-track="tasks.section.tasks">
        Tasks
      </ToggleGroupItem>
      <ToggleGroupItem value="automations" data-track="tasks.section.automations">
        Automations
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
