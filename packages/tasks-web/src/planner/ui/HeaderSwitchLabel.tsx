import type { LucideIcon } from "lucide-react";

/**
 * The Tasks header's container: the header row of every tab, Me and Workers,
 * so both sides switch to icons at the same width.
 */
export const TASKS_HEADER_CONTAINER_CLASS = "@container/tasks-header";

/**
 * A text switch item's content: the name, or below 22rem of header (a phone)
 * its icon, as the Me / Workers switch shows, so the header row fits with its
 * filter and actions. The item carries the name as its aria-label.
 */
export function HeaderSwitchLabel(props: { readonly icon: LucideIcon; readonly label: string }) {
  const Icon = props.icon;
  return (
    <>
      <Icon aria-hidden className="@min-[22rem]/tasks-header:hidden" />
      <span className="@max-[22rem]/tasks-header:hidden">{props.label}</span>
    </>
  );
}
