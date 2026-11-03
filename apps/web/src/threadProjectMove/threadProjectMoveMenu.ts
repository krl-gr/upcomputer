import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import type {
  ExperimentalWebThreadAccessoryProps,
  ExperimentalWebThreadAction,
} from "~/product/WebFeature";
import { readProjects, readThreadShell } from "~/state/entities";
import { moveThreadToProject } from "./moveThreadToProject";
import {
  threadProjectMoveTargets,
  threadProjectMoveUnavailableReason,
} from "./threadProjectMove.logic";

/** "Move to project" in a thread's action menu, with the other projects as its submenu. */
export function threadProjectMoveActions({
  environmentId,
  threadId,
}: ExperimentalWebThreadAccessoryProps): ReadonlyArray<ExperimentalWebThreadAction> {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const thread = readThreadShell(threadRef);
  if (thread === null || thread.archivedAt !== null) return [];
  const targets = threadProjectMoveTargets(readProjects(), thread);
  const unavailableReason = threadProjectMoveUnavailableReason(thread, targets);
  return [
    {
      id: "move-to-project",
      label: "Move to project",
      icon: "folder",
      choices: targets.map((target) => ({ id: target.id, label: target.label })),
      ...(unavailableReason === null ? {} : { unavailableReason }),
      run: (_context, choiceId) => {
        const target = targets.find((candidate) => candidate.id === choiceId);
        if (target !== undefined) void moveThreadToProject(threadRef, target);
      },
    },
  ];
}
