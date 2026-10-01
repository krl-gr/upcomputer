import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Popover, PopoverPopup } from "../../../../apps/web/src/components/ui/popover.tsx";

function currentToken(value: string): string {
  return value.split(",").at(-1)?.trim() ?? "";
}

function replaceCurrentToken(value: string, option: string): string {
  const tokens = value.split(",");
  const completed = tokens
    .slice(0, -1)
    .map((token) => token.trim())
    .filter(Boolean);
  return [...completed, option].join(", ");
}

export function DetailAutocompleteInput({
  value,
  options,
  placeholder,
  ariaLabel,
  className,
  onChange,
}: {
  readonly value: string;
  readonly options: readonly string[];
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly className: string;
  readonly onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => {
    const tokens = value.split(",");
    const query = filtering ? currentToken(value).toLocaleLowerCase() : "";
    const selected = new Set(
      tokens
        .slice(0, -1)
        .map((token) => token.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    return [...new Set(options)]
      .filter((option) => !selected.has(option.toLocaleLowerCase()))
      .filter((option) => option.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  }, [filtering, options, value]);
  const popupOpen = open && suggestions.length > 0;
  const selectedIndex = Math.min(activeIndex, Math.max(0, suggestions.length - 1));

  const selectOption = (option: string) => {
    onChange(replaceCurrentToken(value, option));
    setFiltering(false);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && popupOpen) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && popupOpen) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && popupOpen) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Enter" && popupOpen) {
      const option = suggestions[selectedIndex];
      if (!option) return;
      event.preventDefault();
      event.stopPropagation();
      selectOption(option);
    }
  };

  return (
    <Popover open={popupOpen} onOpenChange={setOpen} triggerId={inputId}>
      <input
        ref={inputRef}
        id={inputId}
        aria-activedescendant={popupOpen ? `${listboxId}-${selectedIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={popupOpen ? listboxId : undefined}
        aria-expanded={popupOpen}
        aria-label={ariaLabel}
        className={className}
        placeholder={placeholder}
        role="combobox"
        value={value}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setFiltering(true);
          setOpen(true);
        }}
        onFocus={() => {
          setActiveIndex(0);
          setFiltering(false);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      <PopoverPopup
        anchor={inputRef}
        align="end"
        initialFocus={false}
        finalFocus={false}
        side="bottom"
        sideOffset={4}
        className="w-48 min-w-48 max-w-[calc(100vw-24px)]"
        viewportClassName="p-1"
      >
        <div id={listboxId} role="listbox" aria-label={`${ariaLabel} suggestions`}>
          {suggestions.map((option, index) => (
            <button
              key={option}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={`flex h-8 w-full items-center rounded-md px-2 text-left text-sm text-foreground outline-none ${index === selectedIndex ? "bg-accent" : "hover:bg-accent"}`}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              <span className="min-w-0 truncate">{option}</span>
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
