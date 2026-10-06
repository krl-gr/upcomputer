import { CheckIcon } from "lucide-react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../../../../apps/web/src/components/ui/combobox.tsx";
import { SelectButton } from "../../../../apps/web/src/components/ui/select.tsx";

/** Label of the closed tag filter. */
export function tagFilterLabel(selected: ReadonlyArray<string>): string {
  if (selected.length === 0) return "All tags";
  if (selected.length === 1) return selected[0]!;
  return `${selected[0]} +${selected.length - 1}`;
}

/**
 * Searchable multi-select of tags for the Tasks header. A task matches only
 * when it has every selected tag.
 */
export function TagFilterCombobox(props: {
  readonly tags: ReadonlyArray<string>;
  readonly value: ReadonlyArray<string>;
  readonly onChange: (tags: string[]) => void;
}) {
  return (
    <Combobox<string, true>
      multiple
      items={[...props.tags]}
      value={[...props.value]}
      onValueChange={(tags) => props.onChange(tags)}
    >
      <ComboboxTrigger
        render={
          <SelectButton
            size="sm"
            className="w-40 shrink-0"
            aria-label="Filter by tags"
            title="Tasks with every selected tag"
          />
        }
      >
        {tagFilterLabel(props.value)}
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="w-60">
        <ComboboxSearchInput aria-label="Search tags" placeholder="Search tags..." />
        <ComboboxEmpty>No matching tags.</ComboboxEmpty>
        <ComboboxList>
          {(tag: string) => (
            <ComboboxItem key={tag} value={tag}>
              <span className="min-w-0 flex-1 truncate">{tag}</span>
              {props.value.includes(tag) ? <CheckIcon className="size-3.5" /> : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
