import type { TaskAudience } from "@t3tools/tasks-contracts/v1";

import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";

/**
 * A task whose audience changed moves to the other side of Tasks: Me (the
 * planner) lists person tasks, Agents (the table) agent tasks. The toast says
 * where it went, and Open shows it there, so it never disappears silently.
 */
export function toastAudienceMoved(audience: TaskAudience, title: string, open: () => void) {
  const id = toastManager.add({
    type: "info",
    title: audience === "agent" ? "Handed to agents" : "Taken back from agents",
    description:
      audience === "agent"
        ? `"${title}" is in Agents now.`
        : `"${title}" is in your planner now. Runs already started keep running.`,
    actionProps: {
      children: "Open",
      onClick: () => {
        toastManager.close(id);
        open();
      },
    },
  });
}
