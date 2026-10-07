import { useId, useState } from "react";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import { Input } from "../../../../../apps/web/src/components/ui/input.tsx";
import { Label } from "../../../../../apps/web/src/components/ui/label.tsx";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../../../../../apps/web/src/components/ui/number-field.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import { DURATION_PRESETS, formatDuration } from "../logic/time.ts";

/** A wall-clock time, HH:MM, or empty for none (replaces wande's multi-section picker). */
export function TimeField(props: {
  readonly id?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoFocus?: boolean;
}) {
  return (
    <Input
      id={props.id}
      type="time"
      step={300}
      value={props.value}
      autoFocus={props.autoFocus}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      aria-label="Start time"
    />
  );
}

const CUSTOM = "custom";
const NONE = "none";

/** Duration in minutes: wande's presets, or a custom number. Null is "use the default". */
export function DurationField(props: {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
}) {
  const preset = props.value === null ? NONE : String(props.value);
  const isPreset =
    props.value === null || DURATION_PRESETS.some((minutes) => minutes === props.value);
  const [custom, setCustom] = useState(!isPreset);
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={custom ? CUSTOM : preset}
        onValueChange={(next) => {
          if (!next) return;
          if (next === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          props.onChange(next === NONE ? null : Number(next));
        }}
      >
        <SelectTrigger size="sm" aria-label="Duration">
          <SelectValue>
            {custom ? "Custom" : props.value === null ? "Default" : formatDuration(props.value)}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={NONE}>Default</SelectItem>
          {DURATION_PRESETS.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {formatDuration(minutes)}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Custom</SelectItem>
        </SelectPopup>
      </Select>
      {custom ? (
        <NumberField
          min={1}
          max={1440}
          value={props.value}
          onValueChange={(next) => props.onChange(next === null ? null : Math.round(next))}
          size="sm"
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label="Shorter" />
            <NumberFieldInput aria-label="Minutes" />
            <NumberFieldIncrement aria-label="Longer" />
          </NumberFieldGroup>
        </NumberField>
      ) : null}
    </div>
  );
}

/**
 * Wande's "Set time & duration": a start time and a duration, saved together.
 * Clear removes both; the entry becomes untimed with the default duration.
 */
export function TimingForm(props: {
  readonly startTime: string | null;
  readonly durationMinutes: number | null;
  readonly onSave: (timing: {
    readonly startTime: string | null;
    readonly durationMinutes: number | null;
  }) => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [time, setTime] = useState(props.startTime ?? "");
  const [duration, setDuration] = useState(props.durationMinutes);
  const canClear = props.startTime !== null || props.durationMinutes !== null;
  return (
    <form
      className="flex w-56 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave({ startTime: time || null, durationMinutes: duration });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-time`}>Start time</Label>
        <TimeField id={`${id}-time`} value={time} onChange={setTime} autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Duration</Label>
        <DurationField value={duration} onChange={setDuration} />
      </div>
      <div className="flex justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!canClear}
          onClick={() => props.onSave({ startTime: null, durationMinutes: null })}
        >
          Clear
        </Button>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="sm" type="submit">
            Done
          </Button>
        </div>
      </div>
    </form>
  );
}
