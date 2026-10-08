import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import type { PlannerAudience } from "../data/preferences.ts";

const LABELS: Record<PlannerAudience, string> = { person: "Mine", agent: "Agents", all: "All" };

/**
 * Mine / Agents / All: whose work the planner lists, in the list header
 * after Tasks / Routines. Under Routines, the agents' routines are automations.
 */
export function AudienceSelect(props: {
  readonly value: PlannerAudience;
  readonly onChange: (value: PlannerAudience) => void;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value === "person" || value === "agent" || value === "all") props.onChange(value);
      }}
    >
      <SelectTrigger className="w-22 min-w-0" size="sm" aria-label="Whose tasks">
        <SelectValue>{LABELS[props.value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {(["person", "agent", "all"] as const).map((audience) => (
          <SelectItem key={audience} value={audience}>
            {LABELS[audience]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
