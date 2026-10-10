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
import type { PlannerTask } from "../data/pendingOps.ts";
import { plannerListShows } from "../data/plannerStore.ts";
import type { PlannerAudience, PlannerKind } from "../data/preferences.ts";
import { AudienceSelect } from "./AudienceSelect.tsx";
import { BulkActions } from "./BulkActions.tsx";
import { IconAction } from "./IconAction.tsx";
import { KindSelect, KindSwitch } from "./KindSwitch.tsx";
import { usePlanner } from "./plannerContext.ts";

export interface PlannerEnvironmentOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The list column's header, and the planner's title bar row with the week
 * header beside it: Planner / Table, Tasks / Routines, Mine / Agents / All,
 * then New, the list menu (Select, Show archive, environment) and hide the
 * week. In select mode it holds the bulk controls instead.
 */
export function ListHeader(props: {
  readonly viewSwitch: ReactNode;
  readonly onKindChange: (kind: PlannerKind) => void;
  readonly onAudienceChange: (audience: PlannerAudience) => void;
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
   * The page's title bar row; off in a right-panel surface, where it is a
   * plain row under the panel's tab bar.
   */
  readonly titleBar: boolean;
}) {
  const { environmentId, windows, audience, kind } = usePlanner();
  // Routines × Agents: the agents' routines are automations, with no select or archive.
  const automationsOnly = !plannerListShows(kind, audience).tasks;
  const pickEnvironment = props.environments.length > 1;
  const weekBeside = props.canHideWeek && !props.weekHidden;
  const newLabel = automationsOnly
    ? "New automation"
    : kind === "routine"
      ? "New routine"
      : "New task";

  return (
    <WorkspacePageHeader
      electron={isElectron && props.titleBar}
      reserveNativeControls={isElectron && props.titleBar && !weekBeside}
      clearCollapsedSidebar={props.titleBar}
      className="border-b border-border"
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
        // Tasks / Routines turns into a select below the width the switch needs
        // (`LIST_HEADER_WIDTH` in `PlannerLayout`). The select wrappers also hold
        // their hidden form inputs, and shrink, truncating, on a phone.
        <div className="@container min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {props.viewSwitch}
            <div className="hidden @min-[26.5rem]:flex">
              <KindSwitch value={kind} onChange={props.onKindChange} />
            </div>
            <div className="flex min-w-0 @min-[26.5rem]:hidden">
              <KindSelect value={kind} onChange={props.onKindChange} />
            </div>
            <div className="flex min-w-0">
              <AudienceSelect value={audience} onChange={props.onAudienceChange} />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <IconAction
                label={newLabel}
                variant="outline"
                size="icon-sm"
                onClick={() =>
                  automationsOnly
                    ? windows.openCreateAutomation()
                    : windows.openCreate(kind === "routine" ? { kind } : {})
                }
              >
                <PlusIcon />
              </IconAction>
              {automationsOnly && !pickEnvironment ? null : (
                <Menu>
                  <MenuTrigger
                    render={<Button size="icon-sm" variant="outline" aria-label="List options" />}
                  >
                    <MoreHorizontalIcon />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {automationsOnly ? null : (
                      <>
                        <MenuItem onClick={() => props.onSelectModeChange(true)}>Select</MenuItem>
                        <MenuCheckboxItem
                          variant="switch"
                          checked={props.showArchived}
                          onCheckedChange={props.onToggleArchived}
                        >
                          Show archive
                        </MenuCheckboxItem>
                      </>
                    )}
                    {pickEnvironment ? (
                      <>
                        {automationsOnly ? null : <MenuSeparator />}
                        <MenuGroup>
                          <MenuGroupLabel>Environment</MenuGroupLabel>
                          <MenuRadioGroup
                            value={environmentId}
                            onValueChange={(value) => props.onEnvironmentChange(String(value))}
                          >
                            {props.environments.map((environment) => (
                              <MenuRadioItem
                                key={environment.id}
                                value={environment.id}
                                closeOnClick
                              >
                                {environment.label}
                              </MenuRadioItem>
                            ))}
                          </MenuRadioGroup>
                        </MenuGroup>
                      </>
                    ) : null}
                  </MenuPopup>
                </Menu>
              )}
              {props.canHideWeek ? (
                <IconAction
                  label={props.weekHidden ? "Show the week" : "Hide the week"}
                  variant="outline"
                  size="icon-sm"
                  onClick={props.onToggleWeek}
                >
                  {props.weekHidden ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
                </IconAction>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </WorkspacePageHeader>
  );
}
