import type { LucideIcon } from "lucide-react";

/**
 * The Tasks header's container: the header row of every tab, Me and Workers,
 * so each switch reads the width its header row has.
 */
export const TASKS_HEADER_CONTAINER_CLASS = "@container/tasks-header";

/**
 * Below which header width each switch shows icons. The planner list header
 * keeps words down to its measured `LIST_HEADER_WIDTH` (324px), the width its
 * column is sized for; the Workers row, with Automations and the filter's
 * count, needs 22rem. Literal classes, so Tailwind sees them.
 */
const COMPACT_CLASSES = {
  listHeader: {
    icon: "@min-[20.25rem]/tasks-header:hidden",
    label: "@max-[20.25rem]/tasks-header:hidden",
  },
  workersHeader: {
    icon: "@min-[22rem]/tasks-header:hidden",
    label: "@max-[22rem]/tasks-header:hidden",
  },
} as const;

/**
 * A text switch item's content: the name, or on a header too narrow for it (a
 * phone) its icon, as the Me / Workers switch shows, so the header row fits
 * with its filter and actions. The item carries the name as its aria-label.
 */
export function HeaderSwitchLabel(props: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly compactBelow: keyof typeof COMPACT_CLASSES;
}) {
  const Icon = props.icon;
  const classes = COMPACT_CLASSES[props.compactBelow];
  return (
    <>
      <Icon aria-hidden className={classes.icon} />
      <span className={classes.label}>{props.label}</span>
    </>
  );
}
