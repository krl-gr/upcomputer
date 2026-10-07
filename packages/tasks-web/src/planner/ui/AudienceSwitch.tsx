import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { PlannerAudience } from "../data/preferences.ts";

const LABELS: Record<PlannerAudience, string> = { person: "Mine", agent: "Agents", all: "All" };

/**
 * Mine / Agents / All: whose work the planner lists, next to the project
 * filter. Under Routines, the agents' routines are automations.
 */
export function AudienceSwitch(props: {
  readonly value: PlannerAudience;
  readonly onChange: (value: PlannerAudience) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Whose tasks"
      value={[props.value]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "person" || next === "agent" || next === "all") props.onChange(next);
      }}
    >
      {(["person", "agent", "all"] as const).map((audience) => (
        <ToggleGroupItem key={audience} value={audience}>
          {LABELS[audience]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
