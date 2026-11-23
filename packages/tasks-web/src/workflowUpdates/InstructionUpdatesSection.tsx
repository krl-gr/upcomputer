import type { EnvironmentId } from "@t3tools/contracts";
import type {
  InstructionUpdateChange,
  InstructionUpdatesMode,
  InstructionUpdateStatus,
} from "@t3tools/tasks-contracts/v1";
import { useGT, useLocale } from "gt-react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsRow,
  SettingsSection,
  useSettingsSearchTarget,
  useSettingsSearchTargetId,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { Button, InlineButton } from "../../../../apps/web/src/components/ui/button.tsx";
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
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { useTasksWebAccess } from "../environmentApi.ts";
import { BeforeAfterList, BeforeAfterText } from "./BeforeAfterText.tsx";
import { DiscussUpdatesButton } from "./DiscussUpdatesButton.tsx";
import { instructionUpdateChangeLabel, instructionUpdateCopy } from "./instructionUpdateCopy.ts";
import {
  type InstructionUpdateView,
  updateInstructionUpdates,
  useInstructionUpdates,
} from "./workflowUpdates.ts";

export const INSTRUCTION_UPDATES_ID = "instruction-updates";
export const instructionUpdateRowId = (entryId: string) => `instruction-update-${entryId}`;

type GT = ReturnType<typeof useGT>;

function isSameDay(left: Date, right: Date) {
  return left.toDateString() === right.toDateString();
}

/** When and by whom an applied or kept update was decided. */
function decisionNote(gt: GT, locale: string, status: InstructionUpdateStatus): string {
  const at = status.decidedAt === null ? null : new Date(status.decidedAt);
  const today = at !== null && isSameDay(at, new Date());
  const date =
    at === null ? "" : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(at);
  if (status.state === "kept")
    return today ? gt("You kept your setup today") : gt("You kept your setup on {date}", { date });
  const by = status.decidedBy;
  if (by?.kind === "auto")
    return today
      ? gt("Applied automatically today")
      : gt("Applied automatically on {date}", { date });
  if (by?.kind === "chat" && by.name !== null)
    return today
      ? gt("Applied today with {bot}", { bot: by.name })
      : gt("Applied on {date} with {bot}", { date, bot: by.name });
  return today ? gt("Applied today in a chat") : gt("Applied on {date} in a chat", { date });
}

function ChangeView({
  change,
  statusNotes,
}: {
  readonly change: InstructionUpdateChange;
  readonly statusNotes: Readonly<Record<string, string>>;
}) {
  const gt = useGT();
  switch (change.kind) {
    case "statuses":
      return <BeforeAfterList before={change.before} after={change.after} notes={statusNotes} />;
    case "groupOrder":
      return <BeforeAfterList before={change.before} after={change.after} />;
    case "prompt":
      return <BeforeAfterText before={change.before} after={change.after} />;
    case "failedOnCrash": {
      const describe = (on: boolean) =>
        on
          ? gt("The task moves to Failed. Continuing the run moves it back to In Progress.")
          : gt("The task keeps its status.");
      return <BeforeAfterText before={describe(change.before)} after={describe(change.after)} />;
    }
  }
}

/** One update: its title and state, and behind the chevron why it changed and both versions. */
function UpdateRow({
  environmentId,
  update,
  mode,
  canMutate,
}: {
  readonly environmentId: EnvironmentId;
  readonly update: InstructionUpdateView;
  readonly mode: InstructionUpdatesMode;
  readonly canMutate: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const { entry, status } = update;
  const copy = instructionUpdateCopy(gt, entry);
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
  const decided = status.state === "applied" || status.state === "kept";
  const setState = (state: "pending" | "kept") =>
    updateInstructionUpdates(environmentId, { entries: [{ id: entry.id, state }] }).catch(() =>
      toastManager.add({
        type: "error",
        title: gt("Couldn't save this change. Try again."),
      }),
    );
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={
        <div
          id={id}
          ref={targetRef}
          tabIndex={-1}
          data-instruction-update={status.state}
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
                decided ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {copy.title}
            </span>
            <span className="block text-xs leading-normal text-muted-foreground">
              {decided
                ? decisionNote(gt, locale, status)
                : mode === "auto" && status.touchesEditedText
                  ? gt("Up.computer {release} · Changes text you edited, so it waits for you", {
                      release: entry.release,
                    })
                  : gt(
                      "Up.computer {release} · {count, plural, one {{count} change} other {{count} changes}} · Not applied",
                      { release: entry.release, count: entry.changes.length },
                    )}
            </span>
          </span>
        </CollapsibleTrigger>
        {status.state === "applied" ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <CheckIcon aria-hidden className="size-3.5 text-success-foreground" />
            {gt("Applied", { $context: "state of an update whose changes were made" })}
          </span>
        ) : status.state === "kept" ? (
          <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            {gt("Kept yours", { $context: "state of an update closed without applying it" })}
            {canMutate ? (
              <InlineButton tone="muted" onClick={() => void setState("pending")}>
                {gt("Reopen", { $context: "button that makes a kept update wait again" })}
              </InlineButton>
            ) : null}
          </span>
        ) : (
          // Wrapped under the title on a narrow row, it starts where the title does.
          <span className="flex items-center gap-2 pl-6 @min-[32rem]/updates:pl-0">
            {canMutate ? (
              <Button
                size="sm"
                variant="ghost-muted"
                data-track="instruction-updates.keep-mine"
                onClick={() => void setState("kept")}
              >
                {gt("Keep mine")}
              </Button>
            ) : null}
            <DiscussUpdatesButton
              environmentId={environmentId}
              entries={[entry]}
              render={<Button size="sm" variant="outline" />}
            />
          </span>
        )}
      </div>
      <CollapsiblePanel>
        <div className="space-y-4 px-3 pb-4 sm:px-4 sm:pl-10">
          <p className="max-w-2xl text-xs leading-normal text-pretty text-muted-foreground">
            {copy.why}
          </p>
          {entry.changes.map((change) => (
            <div key={change.kind === "prompt" ? change.field : change.kind} className="space-y-2">
              <h4 className="text-xs font-medium text-foreground">
                {instructionUpdateChangeLabel(gt, change)}
              </h4>
              <ChangeView change={change} statusNotes={copy.statusNotes} />
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

const MODE_LABELS = (gt: GT): Record<InstructionUpdatesMode, string> => ({
  ask: gt("Ask me"),
  auto: gt("Apply automatically"),
});

/**
 * Settings → Instructions: what happens when a new version changes the shipped
 * instructions and statuses, and the updates. They belong to the install (the
 * environment), so the page shows them only for "All projects".
 */
export function InstructionUpdatesSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const { entries, mode } = useInstructionUpdates(environmentId);
  const canMutate = useTasksWebAccess(environmentId).canMutateTasks;
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
            disabled={!canMutate}
            onValueChange={(value) => {
              if (value === "ask" || value === "auto")
                void updateInstructionUpdates(environmentId, { mode: value }).catch(() =>
                  toastManager.add({
                    type: "error",
                    title: gt("Couldn't save this change. Try again."),
                  }),
                );
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              aria-label={gt("Instruction updates")}
            >
              <SelectValue>{(value: InstructionUpdatesMode) => labels[value]}</SelectValue>
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
      {entries.map((update) => (
        <UpdateRow
          key={update.entry.id}
          environmentId={environmentId}
          update={update}
          mode={mode}
          canMutate={canMutate}
        />
      ))}
    </SettingsSection>
  );
}
