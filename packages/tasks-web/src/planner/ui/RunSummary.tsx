import { BotIcon } from "lucide-react";

import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { TableRunCounts } from "../../ui/RunCountNumbers.tsx";
import { TablePill } from "../../ui/TablePill.tsx";
import { TaskTagChips } from "../../ui/TaskTagChips.tsx";
import { groupTaskRunCounts, taskRunPresentation } from "../../ui/taskRunPresentation.ts";
import type { PlannerTask } from "../data/pendingOps.ts";
import { usePlanner } from "./plannerContext.ts";

/**
 * What agents did and may do with a task, in its row and window: "Agents"
 * for an agent task (a window opened from an automation shows one), its
 * tags, the latest run's status and the run counts (a click opens the task
 * in the table, which lists its runs).
 */
export function RunSummary(props: {
  readonly task: PlannerTask;
  /** Off where the tags are edited instead. */
  readonly showTags?: boolean;
}) {
  const { triggerTags, openInTable } = usePlanner();
  const { task } = props;
  const latest = taskRunPresentation(task.latestRunStatus ?? undefined, false);
  const groups = groupTaskRunCounts(task.runCounts);
  return (
    <>
      {task.audience === "agent" ? (
        <TablePill>
          <BotIcon className="size-3.5" aria-hidden />
          Agents
        </TablePill>
      ) : null}
      {props.showTags === false ? null : (
        <TaskTagChips tags={task.tags} triggerTags={triggerTags} />
      )}
      {latest ? (
        <span className={cn("text-xs", latest.className)} data-latest-run-status="">
          {latest.label}
        </span>
      ) : null}
      {groups.length > 0 ? (
        <span className="text-xs" data-prevent-drag>
          <TableRunCounts groups={groups} onSelect={() => openInTable(task.id)} />
        </span>
      ) : null}
    </>
  );
}
