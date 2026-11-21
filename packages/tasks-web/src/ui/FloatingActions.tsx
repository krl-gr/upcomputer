import type { ReactNode } from "react";

/**
 * Bottom padding for a list under `FloatingActions`, so its last row scrolls
 * clear of the buttons: their 12px offset, their 38px bar and a 14px gap.
 */
export const FLOATING_ACTIONS_CLEARANCE_CLASS = "pb-16";

/**
 * A headerless panel view's controls: the header's own buttons in a small bar
 * over the bottom right corner of the list. The parent is the positioned box.
 */
export function FloatingActions(props: { readonly children: ReactNode }) {
  return (
    <div
      data-tasks-floating-actions=""
      className="pointer-events-none absolute right-3 bottom-3 z-20 flex justify-end"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-background p-1 shadow-md">
        {props.children}
      </div>
    </div>
  );
}
