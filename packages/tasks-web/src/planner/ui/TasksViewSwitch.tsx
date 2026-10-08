import { CalendarDaysIcon, TableIcon } from "lucide-react";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../../apps/web/src/components/ui/tooltip.tsx";
import type { TasksViewMode } from "../data/preferences.ts";

const VIEWS = [
  { value: "planner", label: "Planner", Icon: CalendarDaysIcon },
  { value: "table", label: "Table", Icon: TableIcon },
] as const;

/**
 * Planner or Table. The table's toolbar shows the names; the planner's list
 * header, short on room, shows icons with the names in tooltips.
 */
export function TasksViewSwitch(props: {
  readonly value: TasksViewMode;
  readonly onChange: (value: TasksViewMode) => void;
  readonly icons?: boolean;
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
      {VIEWS.map(({ value, label, Icon }) =>
        props.icons ? (
          <Tooltip key={value}>
            <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} />}>
              <Icon />
            </TooltipTrigger>
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        ) : (
          <ToggleGroupItem key={value} value={value}>
            {label}
          </ToggleGroupItem>
        ),
      )}
    </ToggleGroup>
  );
}
