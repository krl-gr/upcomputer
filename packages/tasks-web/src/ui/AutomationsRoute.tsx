import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { redirectFromAutomations } from "./automationsRedirect.ts";

/** `/automations` now opens the planner on the agents' routines. */
export default function AutomationsRoute() {
  const navigate = useNavigate();
  const search = useLocation({ select: (location) => location.search as Record<string, unknown> });
  useEffect(() => {
    void navigate(redirectFromAutomations(search) as never);
  }, [navigate, search]);
  return null;
}
