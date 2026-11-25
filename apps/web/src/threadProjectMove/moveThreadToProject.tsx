import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { T, Var } from "gt-react";

import { errorToastDescription } from "~/components/errors/ErrorDetails";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import type { ThreadProjectMoveTarget } from "./threadProjectMove.logic";

export async function moveThreadToProject(
  threadRef: ScopedThreadRef,
  target: ThreadProjectMoveTarget,
): Promise<void> {
  if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: <T>Could not move thread</T>,
        description: <T>This connection cannot change threads.</T>,
      }),
    );
    return;
  }
  const command = threadEnvironment.moveProject;
  const result = await runAtomCommand(
    appAtomRegistry,
    command,
    {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, projectId: target.id },
    },
    { label: command.label, reportFailure: false },
  );
  if (result._tag === "Success") {
    // The scratch project's label is msg() text; other labels are project names.
    const title = target.isScratch ? (
      <T>Moved to No project</T>
    ) : (
      <T>
        Moved to <Var>{target.label}</Var>
      </T>
    );
    toastManager.add(stackedThreadToast({ type: "success", title }));
  } else if (!isAtomCommandInterrupted(result)) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: <T>Could not move thread</T>,
        description: errorToastDescription(squashAtomCommandFailure(result)),
      }),
    );
  }
}
