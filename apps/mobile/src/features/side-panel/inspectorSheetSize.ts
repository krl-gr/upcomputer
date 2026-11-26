import { createContext, useState } from "react";

import { formSheetDetents } from "../../native/sheet-surface";

const MEDIUM = 0.6;

/**
 * The inspector sheet's height and the side panel's expand button. UIKit has no call to move a
 * sheet to another detent, and the sheet keeps its detent by index, so the button swaps the
 * detents: full height alone to expand, then medium and full again (index 0 is medium) to restore.
 */
export function useInspectorSheetSize() {
  const [mode, setMode] = useState<"resizable" | "expanded" | "medium">("resizable");
  const [index, setIndex] = useState(0);
  const expanded = mode === "expanded" || (mode === "resizable" && index === 1);
  const detents =
    mode === "expanded" ? [1] : mode === "medium" ? [MEDIUM] : formSheetDetents(MEDIUM, 0.95);
  return {
    detents,
    expanded,
    onDetentChanged: (event: { readonly nativeEvent: { readonly index: number } }) =>
      setIndex(event.nativeEvent.index),
    /** Each opening starts at medium height. */
    reset: () => {
      setMode("resizable");
      setIndex(0);
    },
    toggle: () => {
      setIndex(0);
      // Dragged to full height, the selected index is 1, which a lone medium detent lacks.
      setMode(mode === "expanded" ? "resizable" : expanded ? "medium" : "expanded");
    },
  };
}

export type InspectorSheetSize = ReturnType<typeof useInspectorSheetSize>;

/** Present inside the phone's inspector sheet, absent in the iPad's column. */
export const InspectorSheetSizeContext = createContext<InspectorSheetSize | null>(null);
