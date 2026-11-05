import type { Bot } from "@t3tools/tasks-contracts/v1";
import { BotRow } from "@t3tools/tasks-web/bots";

import { SidebarMenu, SidebarMenuItem } from "../components/ui/sidebar";
import { SIDEBAR_MENU_SCOPE } from "../sidebarMetrics/sidebarMetrics";
import {
  SidebarCompactThreadRow,
  type SidebarCompactThreadRowProps,
} from "../sidebarThreadRow/SidebarCompactThreadRow";
import { ENVIRONMENT_ID, PROJECT } from "./sidebarRowFixtures";
import type { UiState } from "./uiStateSheet";

/* States of the sidebar's thread and bot rows, shared by the sheets that show them. */

export const noop = () => undefined;

export function threadRowProps(
  thread: SidebarCompactThreadRowProps["thread"],
  overrides: Partial<SidebarCompactThreadRowProps> = {},
): SidebarCompactThreadRowProps {
  return {
    thread,
    variantAction: "settle",
    sweepAction: null,
    snoozeWakeLabelText: null,
    isActive: false,
    jumpLabel: null,
    project: PROJECT,
    projectDisplayName: PROJECT.title,
    onThreadClick: noop,
    onThreadActivate: noop,
    onStartRename: noop,
    onRenameTitleChange: noop,
    onCommitRename: noop,
    onCancelRename: noop,
    isRenaming: false,
    renamingTitle: "",
    onContextMenu: noop,
    ...overrides,
  };
}

export function threadRow(props: SidebarCompactThreadRowProps) {
  return () => (
    <ul>
      <SidebarCompactThreadRow {...props} />
    </ul>
  );
}

export async function waitForImages(cell: HTMLElement) {
  await Promise.all([...cell.querySelectorAll("img")].map((image) => image.decode()));
}

export function botState(
  name: string,
  shown: Bot,
  options: { readonly active?: boolean; readonly hover?: boolean } = {},
): UiState {
  return {
    name,
    render: () => (
      <div className={SIDEBAR_MENU_SCOPE}>
        <SidebarMenu>
          <SidebarMenuItem>
            <BotRow
              environmentId={ENVIRONMENT_ID}
              bot={shown}
              active={options.active ?? false}
              onOpen={noop}
              onSettings={noop}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    ),
    settle: (cell) => waitForImages(cell),
    ...(options.hover ? { hover: "[data-sidebar-list-row]" } : {}),
  };
}
