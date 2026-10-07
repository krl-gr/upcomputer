import { useMemo, useState } from "react";

import { DetailAutocompleteInput } from "../../ui/DetailAutocompleteInput.tsx";
import { splitListInput } from "../../ui/shared.ts";
import { usePlanner } from "./plannerContext.ts";

const INPUT_CLASS =
  "h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring";

/**
 * A task's tags, comma separated, saved on blur or Enter; Escape reverts.
 * Suggests the environment's agent trigger tags: adding one hands the task to
 * that agent. Remount it with the task's tags as key to follow server changes.
 */
export function TagsField(props: {
  readonly tags: readonly string[];
  readonly onSave: (tags: string[]) => void;
}) {
  const { triggerTags } = usePlanner();
  const [value, setValue] = useState(props.tags.join(", "));
  const options = useMemo(
    () => [...new Set([...triggerTags, ...props.tags])].sort((a, b) => a.localeCompare(b)),
    [triggerTags, props.tags],
  );
  const save = () => {
    const tags = splitListInput(value);
    if (tags.join("\u0000") !== props.tags.join("\u0000")) props.onSave(tags);
  };
  return (
    <div
      className="flex min-w-0 items-center gap-2 text-sm"
      onBlur={save}
      onKeyDown={(event) => {
        const input = event.target as HTMLInputElement;
        if (event.key === "Enter") input.blur();
        else if (event.key === "Escape") {
          event.stopPropagation();
          setValue(props.tags.join(", "));
          // Blur after the reset renders, so the old tags are what it compares.
          requestAnimationFrame(() => input.blur());
        }
      }}
    >
      <span className="shrink-0 text-muted-foreground">Tags</span>
      <div className="min-w-0 flex-1">
        <DetailAutocompleteInput
          value={value}
          options={options}
          placeholder="Add tags… an agent's tag hands it the task"
          ariaLabel="Task tags"
          className={INPUT_CLASS}
          onChange={setValue}
        />
      </div>
    </div>
  );
}
