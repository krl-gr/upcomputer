import { useNavigation } from "@react-navigation/native";
import { useEffect, useEffectEvent, useRef } from "react";

/**
 * A page opened from the side panel sheet closes the sheet first; when the chat route regains
 * focus, Back to the chat reopens the panel on the view it was showing. Returns the sheet's
 * `onLeaveSheet`.
 */
export function useReopenSidePanelOnReturn(openSidePanel: () => void) {
  const navigation = useNavigation();
  const reopenOnFocus = useRef(false);
  const reopen = useEffectEvent(() => {
    if (!reopenOnFocus.current) return;
    reopenOnFocus.current = false;
    openSidePanel();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the chat route regaining focus after a page the side panel opened over it
  useEffect(() => navigation.addListener("focus", () => reopen()), [navigation]);
  return () => {
    reopenOnFocus.current = true;
  };
}
