import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import type { TaskRunCountGroup } from "./taskRunPresentation.ts";

const NUMBER_BUTTON_CLASS =
  "cursor-pointer rounded-sm hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Run counts as bare numbers in their status colours, in badge order. Sidebar
 * thread rows, their task menu and the Tasks table render these. With
 * `onSelect`, each number is a button for its status.
 */
export function RunCountNumbers(props: {
  readonly groups: readonly TaskRunCountGroup[];
  readonly onSelect?: (group: TaskRunCountGroup) => void;
}) {
  const { onSelect } = props;
  return props.groups.map((group) =>
    onSelect ? (
      <button
        key={group.label}
        type="button"
        className={`${NUMBER_BUTTON_CLASS} ${group.className}`}
        data-run-count={group.label}
        aria-label={`Show ${group.label} runs (${group.count})`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(group);
        }}
      >
        {group.count}
      </button>
    ) : (
      <span key={group.label} className={group.className} data-run-count={group.label}>
        {group.count}
      </span>
    ),
  );
}

/** The counts in words, for example "Failed 1 · Completed 1". */
export function runCountSummary(groups: readonly TaskRunCountGroup[]): string {
  return groups.map((group) => `${group.label} ${group.count}`).join(" · ");
}

/** A task's run counts in a table row: numbers, words in the tooltip, a click per status. */
export function TableRunCounts(props: {
  readonly groups: readonly TaskRunCountGroup[];
  readonly onSelect: (group: TaskRunCountGroup) => void;
}) {
  if (props.groups.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex items-center gap-2 tabular-nums" />}
        data-table-run-counts=""
      >
        <RunCountNumbers groups={props.groups} onSelect={props.onSelect} />
      </TooltipTrigger>
      <TooltipPopup>{runCountSummary(props.groups)}</TooltipPopup>
    </Tooltip>
  );
}
