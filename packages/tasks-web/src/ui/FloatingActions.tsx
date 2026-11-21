import { createContext, use, type ReactNode } from "react";

/**
 * Bottom padding for a list under `FloatingActions`, so its last row scrolls
 * clear of the buttons: their 12px offset, the 40px buttons and a 20px gap.
 */
export const FLOATING_ACTIONS_CLEARANCE_CLASS = "pb-18";

const FloatingActionsContext = createContext(false);

/** True inside `FloatingActions`: a list's button there takes the floating round look. */
export function useFloatingActions(): boolean {
  return use(FloatingActionsContext);
}

/**
 * A headerless panel view's controls: separate round buttons over the bottom
 * right corner of the list, the main one last. The parent is the positioned box.
 */
export function FloatingActions(props: { readonly children: ReactNode }) {
  return (
    <FloatingActionsContext value={true}>
      <div
        data-tasks-floating-actions=""
        className="pointer-events-none absolute right-3 bottom-3 z-20 flex items-center justify-end gap-2 *:pointer-events-auto"
      >
        {props.children}
      </div>
    </FloatingActionsContext>
  );
}
