import { BotIcon, UserIcon } from "lucide-react";

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
  { value: "planner", label: "Me", Icon: UserIcon },
  { value: "table", label: "Agents", Icon: BotIcon },
] as const;

/**
 * Me or Agents, the Tasks page's one axis: Me is the planner with the
 * person's tasks and routines, Agents the table with the agents' tasks and
 * automations. Icons, with the names in tooltips.
 */
export function TasksViewSwitch(props: {
  readonly value: TasksViewMode;
  readonly onChange: (value: TasksViewMode) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Whose tasks"
      variant="segmented-outline"
      value={[props.value]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "planner" || next === "table") props.onChange(next);
      }}
    >
      {VIEWS.map(({ value, label, Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger
            render={
              <ToggleGroupItem
                value={value}
                aria-label={label}
                data-track={`tasks.side.${value}`}
              />
            }
          >
            <Icon />
          </TooltipTrigger>
          <TooltipPopup>{label}</TooltipPopup>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
