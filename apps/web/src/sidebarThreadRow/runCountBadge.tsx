/** A run count in a status colour: the badge of a sidebar row, a task card or a computer. */
export interface RunCountGroup {
  readonly label: string;
  readonly count: number;
  readonly className: string;
}

const NUMBER_BUTTON_CLASS =
  "cursor-pointer rounded-sm hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset";

/**
 * Run counts as bare numbers in their status colours, in badge order. Sidebar
 * thread, bot and computer rows, the task menu and the Tasks table render these.
 * With `onSelect`, each number is a button for its status.
 */
export function RunCountNumbers<Group extends RunCountGroup>(props: {
  readonly groups: readonly Group[];
  readonly onSelect?: (group: Group) => void;
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
export function runCountSummary(groups: readonly RunCountGroup[]): string {
  return groups.map((group) => `${group.label} ${group.count}`).join(" · ");
}

/**
 * The compact sidebar's run count pill, over a bot's face or a computer's icon:
 * light in either theme. Its owner places it and adds any interaction.
 */
export const RUN_COUNT_PILL_SURFACE = "bg-neutral-200 dark:bg-neutral-100";
export const RUN_COUNT_PILL = `flex h-[18px] flex-none items-center gap-1 rounded-full px-[5.5px] text-[11.5px] leading-[18px] font-semibold tabular-nums ${RUN_COUNT_PILL_SURFACE}`;

/** A group's status colour as the light theme draws it, for the pill. */
export function onLightRunCountGroup<Group extends RunCountGroup>(group: Group): Group {
  return {
    ...group,
    className: group.className
      .split(" ")
      .filter((name) => !name.startsWith("dark:"))
      .map((name) => (name === "text-muted-foreground" ? "text-neutral-500" : name))
      .join(" "),
  };
}
