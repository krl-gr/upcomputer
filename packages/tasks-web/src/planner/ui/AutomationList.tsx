import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { TaskAutomationListItem } from "@t3tools/tasks-contracts/v1";

import { MenuItem, MenuSeparator } from "../../../../../apps/web/src/components/ui/menu.tsx";
import type { AutomationSnapshot } from "../data/automationStore.ts";
import { AutomationRow } from "./AutomationRow.tsx";
import { usePlanner } from "./plannerContext.ts";
import { PointMenu, type MenuPoint } from "./PointMenu.tsx";
import { ConfirmDeleteDialog } from "./TaskDialogs.tsx";
import type { ListDropIndicator } from "./TaskList.tsx";

/**
 * The environment's automations in the person's order, in the Agents side's
 * Automations section. A row drags among automations; its menu enables,
 * disables or deletes it.
 */
export function AutomationList(props: {
  readonly snapshot: AutomationSnapshot;
  readonly indicator: ListDropIndicator | null;
}) {
  const { automations } = usePlanner();
  const [menu, setMenu] = useState<{
    automation: TaskAutomationListItem;
    point: MenuPoint;
  } | null>(null);
  const [deleting, setDeleting] = useState<TaskAutomationListItem | null>(null);
  const { setNodeRef: setBottomNode } = useDroppable({
    id: "automation-list-bottom",
    data: { type: "automation-bottom" },
  });
  const rows = props.snapshot.automations;
  return (
    <div className="mx-auto w-full max-w-3xl py-2">
      {props.snapshot.error ? (
        <p className="px-6 py-2 text-sm text-destructive-foreground">{props.snapshot.error}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">
          {props.snapshot.status === "loading"
            ? "Loading…"
            : "No automations yet. An automation creates a task for agents on a schedule."}
        </p>
      ) : (
        rows.map((automation) => (
          <AutomationRow
            key={automation.id}
            automation={automation}
            indicator={props.indicator?.taskId === automation.id ? props.indicator.position : null}
            onMenu={(target, point) => setMenu({ automation: target, point })}
          />
        ))
      )}
      <div ref={setBottomNode} className="h-6" />
      <PointMenu point={menu?.point ?? null} onClose={() => setMenu(null)}>
        {menu ? (
          <>
            <MenuItem
              onClick={() =>
                void automations.setStatus(
                  menu.automation.id,
                  menu.automation.status === "enabled" ? "disabled" : "enabled",
                )
              }
            >
              {menu.automation.status === "enabled" ? "Disable" : "Enable"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setDeleting(menu.automation)}>
              Delete automation
            </MenuItem>
          </>
        ) : null}
      </PointMenu>
      <ConfirmDeleteDialog
        open={deleting !== null}
        title="Delete automation"
        description={`"${deleting?.name ?? "This automation"}" stops creating tasks. The tasks it created stay in the table. This cannot be undone.`}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) void automations.remove(deleting.id);
        }}
      />
    </div>
  );
}
