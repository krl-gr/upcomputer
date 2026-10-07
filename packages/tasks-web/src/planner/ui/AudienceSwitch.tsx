import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { PlannerAudience } from "../data/preferences.ts";

const LABELS: Record<PlannerAudience, string> = { person: "Mine", agent: "Agents", all: "All" };

/** Mine / Agents / All: whose tasks the planner lists, next to the project filter. */
export function AudienceSwitch(props: {
  readonly value: PlannerAudience;
  readonly onChange: (value: PlannerAudience) => void;
  /** Routines are always the person's, so the switch rests while they show. */
  readonly disabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label="Whose tasks"
      disabled={props.disabled ?? false}
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
