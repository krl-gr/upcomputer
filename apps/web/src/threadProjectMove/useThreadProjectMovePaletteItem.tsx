import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { isBotChatThread } from "@t3tools/tasks-web/feature";
import { useGT, useMessages } from "gt-react";
import { FolderIcon, FolderInputIcon, MessageSquareDashedIcon } from "lucide-react";

import {
  ADDON_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
  ITEM_ICON_CLASS,
} from "~/components/CommandPalette.logic";
import { useProjects, useThreadShell } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { moveThreadToProject } from "./moveThreadToProject";
import {
  threadProjectMoveTargets,
  threadProjectMoveUnavailableReason,
} from "./threadProjectMove.logic";

const SEARCH_TERMS = ["move", "project", "folder", "change project"];

/** "Move thread to project..." for the open thread: a project submenu, or greyed out with why. */
export function useThreadProjectMovePaletteItem(
  threadRef: ScopedThreadRef | null,
): CommandPaletteActionItem | CommandPaletteSubmenuItem | null {
  const gt = useGT();
  const m = useMessages();
  const thread = useThreadShell(threadRef);
  const projects = useProjects();
  const canOperate = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  if (
    threadRef === null ||
    thread === null ||
    thread.archivedAt !== null ||
    isBotChatThread(threadRef)
  )
    return null;
  const targets = threadProjectMoveTargets(projects, thread);
  const unavailableReason = canOperate
    ? m(threadProjectMoveUnavailableReason(thread, targets))
    : gt("This connection cannot change threads");
  const icon = <FolderInputIcon className={ITEM_ICON_CLASS} />;
  if (unavailableReason !== null) {
    return {
      kind: "action",
      value: "action:move-thread-to-project",
      searchTerms: SEARCH_TERMS,
      title: gt("Move thread to project..."),
      description: unavailableReason,
      icon,
      disabled: true,
      run: async () => {},
    };
  }
  return {
    kind: "submenu",
    value: "action:move-thread-to-project",
    searchTerms: SEARCH_TERMS,
    title: gt("Move thread to project..."),
    icon,
    addonIcon: <FolderInputIcon className={ADDON_ICON_CLASS} />,
    groups: [
      {
        value: "move-thread-to-project",
        label: gt("Projects"),
        items: targets.map((target) => ({
          kind: "action" as const,
          value: `move-thread-to-project:${target.id}`,
          searchTerms: [target.label, target.workspaceRoot],
          // The scratch project's label is msg() text; other labels are project names.
          title: target.isScratch ? m(target.label) : target.label,
          description: target.workspaceRoot,
          icon: target.isScratch ? (
            <MessageSquareDashedIcon className={ITEM_ICON_CLASS} />
          ) : (
            <FolderIcon className={ITEM_ICON_CLASS} />
          ),
          run: () => moveThreadToProject(threadRef, target),
        })),
      },
    ],
  };
}
