import type { ReactNode } from "react";
import { ListFilterIcon } from "lucide-react";
import type { TaskArchiveFilter } from "@t3tools/tasks-contracts/v1";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "../../../../apps/web/src/components/ui/popover.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import {
  ALL_FILTER,
  ARCHIVE_OPTIONS,
  DEFAULT_TASKS_PAGE_FILTERS,
  LAST_RUN_OPTIONS,
  appliedTaskFilterCount,
  type TasksPageFilters,
} from "./pageFilters.ts";
import { TagFilterCombobox } from "./TagFilterCombobox.tsx";

interface TaskFilterSelectsProps {
  readonly filters: TasksPageFilters;
  readonly onFiltersChange: (filters: TasksPageFilters) => void;
  readonly statusOptions: readonly string[];
  readonly tagOptions: readonly string[];
}

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      {props.children}
    </div>
  );
}

/**
 * The status, last-run, tag and archive filters of the agents' tasks: in a row
 * in the wide header, or stacked under their labels in the filter popover.
 */
function TaskFilterSelects(props: TaskFilterSelectsProps & { readonly stacked: boolean }) {
  const { filters, onFiltersChange, stacked } = props;
  const archiveFilter: TaskArchiveFilter = filters.archive ?? "active";
  const width = (header: string) => (stacked ? "w-full" : `${header} shrink-0`);
  const field = (label: string, control: ReactNode) =>
    stacked ? <Field label={label}>{control}</Field> : control;
  return (
    <>
      {field(
        "Status",
        <Select
          value={filters.status}
          onValueChange={(value) => {
            if (value) onFiltersChange({ ...filters, status: value });
          }}
        >
          <SelectTrigger className={width("w-40")} size="sm" aria-label="Filter by status">
            <SelectValue>
              {filters.status === ALL_FILTER ? "All statuses" : filters.status}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={ALL_FILTER}>All statuses</SelectItem>
            {props.statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>,
      )}
      {field(
        "Last run",
        <Select
          value={filters.lastRun}
          onValueChange={(value) => {
            if (value) onFiltersChange({ ...filters, lastRun: value });
          }}
        >
          <SelectTrigger
            className={width("w-36")}
            size="sm"
            aria-label="Filter by last run"
            title="Status of each task's latest run"
          >
            <SelectValue>
              {filters.lastRun === ALL_FILTER
                ? "Any last run"
                : (LAST_RUN_OPTIONS.find((option) => option.value === filters.lastRun)?.label ??
                  filters.lastRun)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={ALL_FILTER}>Any last run</SelectItem>
            {LAST_RUN_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>,
      )}
      {field(
        "Tags",
        <TagFilterCombobox
          tags={props.tagOptions}
          value={filters.tags}
          onChange={(tags) => onFiltersChange({ ...filters, tags })}
          className={width("w-40")}
        />,
      )}
      {field(
        "Show",
        <Select
          value={archiveFilter}
          onValueChange={(value) => {
            const option = ARCHIVE_OPTIONS.find((candidate) => candidate.value === value);
            if (option) onFiltersChange({ ...filters, archive: option.value });
          }}
        >
          <SelectTrigger className={width("w-44")} size="sm" aria-label="Filter by archive">
            <SelectValue>
              {ARCHIVE_OPTIONS.find((option) => option.value === archiveFilter)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {ARCHIVE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>,
      )}
    </>
  );
}

/** The wide header's filters, in a row after the project select. */
export function TaskFilterRow(props: TaskFilterSelectsProps) {
  return <TaskFilterSelects {...props} stacked={false} />;
}

/**
 * The narrow header's one filter button: the icon and how many filters are
 * applied, opening the project select and the four filters stacked, with Reset.
 */
export function TaskFiltersButton(
  props: TaskFilterSelectsProps & {
    /** The shared project select; it fills the popover's width. */
    readonly projectSelect: ReactNode;
    readonly projectChosen: boolean;
    readonly onProjectReset: () => void;
  },
) {
  const count = appliedTaskFilterCount(props.filters, props.projectChosen);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size={count > 0 ? "sm" : "icon-sm"}
            aria-label={count > 0 ? `Filters, ${count} applied` : "Filters"}
            data-task-filters-button=""
          />
        }
      >
        <ListFilterIcon />
        {count > 0 ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
      </PopoverTrigger>
      <PopoverPopup align="end" padding="compact">
        <div className="flex w-56 flex-col gap-3 py-1">
          {props.projectSelect ? (
            <div className="contents [&_[data-slot=select-trigger]]:w-full">
              <Field label="Project">{props.projectSelect}</Field>
            </div>
          ) : null}
          <TaskFilterSelects {...props} stacked />
          <Button
            variant="link"
            size="xs"
            className="self-start"
            disabled={count === 0}
            onClick={() => {
              props.onFiltersChange(DEFAULT_TASKS_PAGE_FILTERS);
              if (props.projectChosen) props.onProjectReset();
            }}
          >
            Reset
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
