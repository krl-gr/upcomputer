import { useGT } from "gt-react";
import type { ReactNode } from "react";
import {
  MoreHorizontalIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PlusIcon,
} from "lucide-react";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../../../../apps/web/src/components/ui/menu.tsx";
import { isElectron } from "../../../../../apps/web/src/env.ts";
import { WorkspacePageHeader } from "../../../../../apps/web/src/extensionApi.ts";
import { useFloatingActions } from "../../ui/FloatingActions.tsx";
import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import type { PlannerKind } from "../data/preferences.ts";
import { BulkActions } from "./BulkActions.tsx";
import { IconAction } from "./IconAction.tsx";
import { TASKS_HEADER_CONTAINER_CLASS } from "./HeaderSwitchLabel.tsx";
import { KindSwitch } from "./KindSwitch.tsx";
import { usePlanner } from "./plannerContext.ts";

export interface PlannerEnvironmentOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The list column's header, beside the week header in the planner's title
 * bar row, or stacked on the list: Me / Workers, Tasks / Routines, then New, the list menu
 * (Select, Show archive, environment) and hide the week. In select mode it
 * holds the bulk controls instead.
 */
export function ListHeader(props: {
  readonly viewSwitch: ReactNode;
  readonly onKindChange: (kind: PlannerKind) => void;
  /** Listed in the menu only when there is more than one. */
  readonly environments: readonly PlannerEnvironmentOption[];
  readonly onEnvironmentChange: (environmentId: string) => void;
  readonly showArchived: boolean;
  readonly onToggleArchived: () => void;
  readonly selectMode: boolean;
  readonly selected: readonly PlannerTask[];
  readonly queueDate: string | null;
  readonly onSelectModeChange: (selectMode: boolean) => void;
  readonly onMoveUnder: () => void;
  readonly onDelete: () => void;
  readonly canHideWeek: boolean;
  readonly weekHidden: boolean;
  readonly onToggleWeek: () => void;
  /**
   * The page's title bar row beside the week header; off when stacked on the
   * list and in a right-panel surface, where it is a plain row.
   */
  readonly titleBar: boolean;
}) {
  const { kind } = usePlanner();
  const weekBeside = props.canHideWeek && !props.weekHidden;

  return (
    <WorkspacePageHeader
      electron={isElectron && props.titleBar}
      reserveNativeControls={isElectron && props.titleBar && !weekBeside}
      clearCollapsedSidebar={props.titleBar}
      className={`${TASKS_HEADER_CONTAINER_CLASS} border-b border-border`}
    >
      {props.selectMode ? (
        <BulkActions
          selected={props.selected}
          queueDate={props.queueDate}
          onExit={() => props.onSelectModeChange(false)}
          onMoveUnder={props.onMoveUnder}
          onDelete={props.onDelete}
        />
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {props.viewSwitch}
            <KindSwitch value={kind} onChange={props.onKindChange} />
            <div className="ml-auto flex items-center gap-1">
              <ListActions {...props} />
            </div>
          </div>
        </div>
      )}
    </WorkspacePageHeader>
  );
}

type ListActionsProps = Pick<
  Parameters<typeof ListHeader>[0],
  | "environments"
  | "onEnvironmentChange"
  | "showArchived"
  | "onToggleArchived"
  | "onSelectModeChange"
  | "canHideWeek"
  | "weekHidden"
  | "onToggleWeek"
>;

/**
 * The list's own buttons: New, the list menu (Select, Show archive,
 * environment) and hide the week. In the list header, or floating over the
 * list where a panel entry shows it without one.
 */
export function ListActions(props: ListActionsProps) {
  const gt = useGT();
  const { environmentId, windows, kind } = usePlanner();
  const pickEnvironment = props.environments.length > 1;
  // Over a headerless list the buttons are round, and New comes last, in the corner.
  const floating = useFloatingActions();
  const variant = floating ? "floating" : "outline";
  const size = floating ? "icon-floating" : "icon-sm";
  const create = (
    <IconAction
      label={kind === "routine" ? gt("New routine") : gt("New task")}
      track={kind === "routine" ? "planner.create_routine" : "planner.create_task"}
      variant={variant}
      size={size}
      onClick={() => windows.openCreate(kind === "routine" ? { kind } : {})}
    >
      <PlusIcon />
    </IconAction>
  );
  const menu = (
    <Menu>
      <MenuTrigger
        render={<Button size={size} variant={variant} aria-label={gt("List options")} />}
      >
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => props.onSelectModeChange(true)}>
          {gt("Select", { $context: "menu item that turns on select mode" })}
        </MenuItem>
        <MenuCheckboxItem
          variant="switch"
          checked={props.showArchived}
          onCheckedChange={props.onToggleArchived}
        >
          {gt("Show archive")}
        </MenuCheckboxItem>
        {pickEnvironment ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>{gt("Environment")}</MenuGroupLabel>
              <MenuRadioGroup
                value={environmentId}
                onValueChange={(value) => props.onEnvironmentChange(String(value))}
              >
                {props.environments.map((environment) => (
                  <MenuRadioItem key={environment.id} value={environment.id} closeOnClick>
                    {environment.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
  const week = props.canHideWeek ? (
    <IconAction
      label={props.weekHidden ? gt("Show the week") : gt("Hide the week")}
      variant={variant}
      size={size}
      onClick={props.onToggleWeek}
    >
      {props.weekHidden ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
    </IconAction>
  ) : null;
  return floating ? (
    <>
      {week}
      {menu}
      {create}
    </>
  ) : (
    <>
      {create}
      {menu}
      {week}
    </>
  );
}
