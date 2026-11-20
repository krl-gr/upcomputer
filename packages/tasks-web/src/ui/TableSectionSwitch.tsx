import { CalendarClockIcon, ListTodoIcon } from "lucide-react";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { TableSection } from "../planner/data/preferences.ts";
import { useGT } from "gt-react";
import { HeaderSwitchLabel } from "../planner/ui/HeaderSwitchLabel.tsx";

/**
 * Tasks / Automations: what the Workers side lists, beside the Me / Workers
 * switch. Automations are the agents' routines: each creates agent tasks on
 * a schedule, and those tasks show under Tasks.
 */
export function TableSectionSwitch(props: {
  readonly value: TableSection;
  readonly onChange: (section: TableSection) => void;
}) {
  const gt = useGT();
  return (
    <ToggleGroup
      aria-label={gt("Worker tasks or automations")}
      variant="segmented-outline"
      value={[props.value]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "tasks" || next === "automations") props.onChange(next);
      }}
    >
      <ToggleGroupItem value="tasks" aria-label={gt("Tasks")} data-track="tasks.section.tasks">
        <HeaderSwitchLabel icon={ListTodoIcon} label={gt("Tasks")} compactBelow="workersHeader" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="automations"
        aria-label={gt("Automations")}
        data-track="tasks.section.automations"
      >
        <HeaderSwitchLabel
          icon={CalendarClockIcon}
          label={gt("Automations")}
          compactBelow="workersHeader"
        />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
