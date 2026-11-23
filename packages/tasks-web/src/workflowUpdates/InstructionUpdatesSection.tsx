import { useGT } from "gt-react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsRow,
  SettingsSection,
  useSettingsSearchTarget,
  useSettingsSearchTargetId,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../../../apps/web/src/components/ui/collapsible.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { BeforeAfterText } from "./BeforeAfterText.tsx";
import { DiscussUpdatesButton } from "./DiscussUpdatesButton.tsx";
import {
  type InstructionUpdateEntry,
  type InstructionUpdateMode,
  setInstructionUpdateMode,
  useInstructionUpdates,
} from "./workflowUpdates.ts";

export const INSTRUCTION_UPDATES_ID = "instruction-updates";
export const instructionUpdateRowId = (entryId: string) => `instruction-update-${entryId}`;

/** One update: its title and state, and behind the chevron why it changed and both texts. */
function UpdateRow({
  entry,
  mode,
}: {
  readonly entry: InstructionUpdateEntry;
  readonly mode: InstructionUpdateMode;
}) {
  const gt = useGT();
  const id = instructionUpdateRowId(entry.id);
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(id);
  const targetId = useSettingsSearchTargetId();
  const [open, setOpen] = useState(false);
  // The bell's "What changed" lands on the row, so it opens before the scroll runs.
  const [openedForTarget, setOpenedForTarget] = useState(false);
  if (targetId === id && !openedForTarget) {
    setOpenedForTarget(true);
    if (!open) setOpen(true);
  }
  const applied = entry.state === "applied";
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={
        <div
          id={id}
          ref={targetRef}
          tabIndex={-1}
          data-instruction-update={entry.state}
          className="@container/updates outline-none"
        />
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:px-4">
        <CollapsibleTrigger className="flex min-w-0 flex-1 basis-52 items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 space-y-1">
            <span
              className={cn(
                "block text-sm font-medium",
                applied ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {entry.title}
            </span>
            <span className="block text-xs leading-normal text-muted-foreground">
              {applied
                ? entry.appliedNote
                : mode === "auto" && entry.touchesEditedText
                  ? gt("Up.computer {release} · Changes text you edited, so it waits for you", {
                      release: entry.release,
                    })
                  : gt(
                      "Up.computer {release} · {count, plural, one {# change} other {# changes}} · Not applied",
                      { release: entry.release, count: entry.changes.length },
                    )}
            </span>
          </span>
        </CollapsibleTrigger>
        {applied ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <CheckIcon aria-hidden className="size-3.5 text-success-foreground" />
            {gt("Applied")}
          </span>
        ) : (
          // Wrapped under the title on a narrow row, it starts where the title does.
          <span className="pl-6 @min-[32rem]/updates:pl-0">
            <DiscussUpdatesButton
              entries={[entry]}
              render={<Button size="sm" variant="outline" />}
            />
          </span>
        )}
      </div>
      <CollapsiblePanel>
        <div className="space-y-4 px-3 pb-4 sm:px-4 sm:pl-10">
          <p className="max-w-2xl text-xs leading-normal text-pretty text-muted-foreground">
            {entry.why}
          </p>
          {entry.changes.map((change) => (
            <div key={change.id} className="space-y-2">
              <h4 className="text-xs font-medium text-foreground">{change.label}</h4>
              <BeforeAfterText before={change.before} after={change.after} />
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

const MODE_LABELS = (gt: ReturnType<typeof useGT>): Record<InstructionUpdateMode, string> => ({
  ask: gt("Ask me"),
  auto: gt("Apply automatically"),
});

/**
 * Settings → Instructions: what happens when a new version changes the shipped
 * instructions and statuses, and the updates that wait for a decision.
 */
export function InstructionUpdatesSection() {
  const gt = useGT();
  const { entries, mode } = useInstructionUpdates();
  const labels = MODE_LABELS(gt);
  return (
    <SettingsSection id={INSTRUCTION_UPDATES_ID} title={gt("Instruction updates")} hideTitle>
      <SettingsRow
        title={gt("Instruction updates")}
        description={
          mode === "ask"
            ? gt(
                "A new version of Up.computer can change its default instructions and task statuses. Nothing changes until you decide.",
              )
            : gt(
                "A new version of Up.computer can change its default instructions and task statuses. Text you edited is never replaced: those updates still wait for you.",
              )
        }
        control={
          <Select
            value={mode}
            onValueChange={(value) => {
              if (value === "ask" || value === "auto") setInstructionUpdateMode(value);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              aria-label={gt("Instruction updates")}
            >
              <SelectValue>{(value: InstructionUpdateMode) => labels[value]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="ask">
                {labels.ask}
              </SelectItem>
              <SelectItem hideIndicator value="auto">
                {labels.auto}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {entries.map((entry) => (
        <UpdateRow key={entry.id} entry={entry} mode={mode} />
      ))}
    </SettingsSection>
  );
}
