import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../../../apps/web/src/components/ui/toggle-group.tsx";
import type { PlannerKind } from "../data/preferences.ts";

const LABELS: Record<PlannerKind, string> = { task: "Tasks", routine: "Routines" };

const kindOf = (value: unknown) => (value === "task" || value === "routine" ? value : null);

/**
 * Tasks / Routines: wande's two tabs, what the planner lists. Sits in the
 * list header left of Mine / Agents / All, its other axis.
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
      <ToggleGroupItem value="task">{LABELS.task}</ToggleGroupItem>
      <ToggleGroupItem value="routine">{LABELS.routine}</ToggleGroupItem>
    </ToggleGroup>
  );
}

/** `KindSwitch` as a select, for a list header too narrow for the switch. */
export function KindSelect(props: {
  readonly value: PlannerKind;
  readonly onChange: (kind: PlannerKind) => void;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        const next = kindOf(value);
        if (next) props.onChange(next);
      }}
    >
      <SelectTrigger className="w-24 min-w-0" size="sm" aria-label="Tasks or routines">
        <SelectValue>{LABELS[props.value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {(["task", "routine"] as const).map((kind) => (
          <SelectItem key={kind} value={kind}>
            {LABELS[kind]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
