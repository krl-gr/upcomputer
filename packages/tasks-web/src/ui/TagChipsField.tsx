import { PlusIcon, XIcon } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Popover, PopoverPopup } from "../../../../apps/web/src/components/ui/popover.tsx";
import { splitListInput } from "./shared.ts";
import { TablePill } from "./TablePill.tsx";
import type { TagSuggestion } from "./tagSuggestions.ts";

/**
 * An agent task's tags as chips: x removes one, "+" opens an input that
 * suggests agents' trigger tags (with the agents' names) and tags in use.
 * Enter adds the typed tag (or the suggestion picked with the arrows), Escape
 * cancels, Backspace in the empty input removes the last chip. Every change
 * saves at once.
 */
export function TagChipsField(props: {
  readonly tags: readonly string[];
  readonly suggest: (query: string) => readonly TagSuggestion[];
  readonly disabled?: boolean;
  readonly onChange: (tags: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const listboxId = useId();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  // -1 until the arrows pick a suggestion, so Enter adds what was typed.
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = adding ? props.suggest(query).slice(0, 8) : [];
  const popupOpen = suggestions.length > 0;

  const add = (text: string) => {
    setQuery("");
    setActiveIndex(-1);
    const added = splitListInput(text).filter((tag) => !props.tags.includes(tag));
    if (added.length > 0) props.onChange([...props.tags, ...added]);
  };
  const close = () => {
    setAdding(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add(suggestions[activeIndex]?.tag ?? query);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Backspace" && query === "" && props.tags.length > 0) {
      event.preventDefault();
      props.onChange(props.tags.slice(0, -1));
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && popupOpen) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + suggestions.length) % suggestions.length);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
      {props.tags.map((tag) => (
        <TablePill key={tag} className="max-w-full pe-0.5">
          <span className="truncate">{tag}</span>
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none"
            aria-label={`Remove tag ${tag}`}
            disabled={props.disabled}
            onClick={() => props.onChange(props.tags.filter((other) => other !== tag))}
          >
            <XIcon className="size-3" />
          </button>
        </TablePill>
      ))}
      {adding ? (
        <Popover open={popupOpen} triggerId={inputId}>
          <input
            ref={inputRef}
            id={inputId}
            autoFocus
            role="combobox"
            aria-label="Add a tag"
            aria-autocomplete="list"
            aria-expanded={popupOpen}
            aria-controls={popupOpen ? listboxId : undefined}
            aria-activedescendant={
              popupOpen && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
            }
            className="h-6 w-28 min-w-0 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Tag…"
            value={query}
            disabled={props.disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              add(query);
              close();
            }}
          />
          <PopoverPopup
            anchor={inputRef}
            align="end"
            initialFocus={false}
            finalFocus={false}
            side="bottom"
            sideOffset={4}
            className="w-64 min-w-48 max-w-[calc(100vw-24px)]"
            padding="compact"
          >
            <div id={listboxId} role="listbox" aria-label="Tag suggestions">
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.tag}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none ${index === activeIndex ? "bg-accent" : "hover:bg-accent"}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => add(suggestion.tag)}
                >
                  <span className="min-w-0 truncate">{suggestion.tag}</span>
                  {suggestion.agents.length > 0 ? (
                    <span className="ms-auto min-w-0 truncate text-xs text-muted-foreground">
                      {suggestion.agents.join(", ")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </PopoverPopup>
        </Popover>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add a tag"
          disabled={props.disabled}
          onClick={() => setAdding(true)}
        >
          <PlusIcon />
        </Button>
      )}
    </div>
  );
}
