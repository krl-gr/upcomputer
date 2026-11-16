import type { TaskAudience } from "@t3tools/tasks-contracts/v1";
import { gtFallback, type useGT } from "gt-react";

import { toastManager } from "../../../../../apps/web/src/components/ui/toast.tsx";

/**
 * A task whose audience changed moves to the other side of Tasks: Me (the
 * planner) lists person tasks, Workers (the table) agent tasks. The toast says
 * where it went, and Open shows it there, so it never disappears silently.
 * Components pass their `useGT()`; without it the text stays English.
 */
export function toastAudienceMoved(
  audience: TaskAudience,
  title: string,
  open: () => void,
  gt: ReturnType<typeof useGT> = gtFallback,
) {
  const id = toastManager.add({
    type: "info",
    title: audience === "agent" ? gt("Handed to workers") : gt("Taken back from workers"),
    description:
      audience === "agent"
        ? gt('"{title}" is in Workers now.', { title })
        : gt('"{title}" is in your planner now. Runs already started keep running.', { title }),
    actionProps: {
      children: gt("Open", { $context: "button that opens the moved task" }),
      onClick: () => {
        toastManager.close(id);
        open();
      },
    },
  });
}
