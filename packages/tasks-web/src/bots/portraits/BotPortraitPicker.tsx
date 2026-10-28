import { useState } from "react";
import type { BotPortraitId } from "@t3tools/tasks-contracts/v1";
import type { BotCharacterState } from "../../../../../apps/web/src/components/bot-character-configurable/catalog.ts";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../../../../apps/web/src/components/ui/dialog.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../../apps/web/src/components/ui/tooltip.tsx";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { BotPortrait } from "./BotPortrait.tsx";
import { botPortraitLabel, botPortraits } from "./botPortraits.ts";

/** The bot's portrait as a button that opens a grid of every portrait to pick from. */
export function BotPortraitPicker({
  value,
  state,
  disabled,
  onChange,
}: {
  readonly value: BotPortraitId;
  readonly state: BotCharacterState;
  readonly disabled: boolean;
  readonly onChange: (portrait: BotPortraitId) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = botPortraitLabel(value);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex w-24 shrink-0 flex-col items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Change portrait, now ${label}`}
                disabled={disabled}
                className="flex size-20 items-center justify-center rounded-xl outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                onClick={() => setOpen(true)}
              />
            }
          >
            <BotPortrait portrait={value} state={state} size={64} />
          </TooltipTrigger>
          <TooltipPopup side="top">Change portrait</TooltipPopup>
        </Tooltip>
        <span className="w-full truncate text-center text-xs text-muted-foreground">{label}</span>
      </div>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a portrait</DialogTitle>
          <DialogDescription>The bot shows this face in the sidebar and here.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div
            role="radiogroup"
            aria-label="Portrait"
            className="grid grid-cols-4 gap-1 sm:grid-cols-7"
          >
            {botPortraits.map((portrait) => {
              const selected = portrait.id === value;
              return (
                <button
                  key={portrait.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-1 rounded-lg border border-transparent px-1 pt-2 pb-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "border-border bg-accent",
                  )}
                  onClick={() => {
                    onChange(portrait.id);
                    setOpen(false);
                  }}
                >
                  <BotPortrait portrait={portrait.id} size={48} />
                  <span className="line-clamp-2 min-h-8 text-center text-xs leading-4 text-muted-foreground">
                    {portrait.label}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
