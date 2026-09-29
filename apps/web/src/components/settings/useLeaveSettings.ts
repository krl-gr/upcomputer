import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { lastChatLocation } from "../../lib/lastChatLocation";

/** Leaves settings for the chat that was open before, falling back to history, then "/". */
export function useLeaveSettings(): () => void {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  return useCallback(() => {
    const href = lastChatLocation();
    if (href !== null) {
      void navigate({ href, replace: true });
      return;
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canGoBack, navigate]);
}
