import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { lastChatLocation } from "../../lib/lastChatLocation";

/**
 * Leaves settings for the chat that was open before. Falls back to "/" (a new
 * chat) only when no chat was opened in this tab. History is not used: going
 * back can land on another settings route.
 */
export function useLeaveSettings(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ href: lastChatLocation() ?? "/", replace: true });
  }, [navigate]);
}
