import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import {
  RunCountNumbers,
  runCountSummary,
} from "../../../../apps/web/src/sidebarThreadRow/runCountBadge.tsx";
import type { TaskRunCountGroup } from "./taskRunPresentation.ts";

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
