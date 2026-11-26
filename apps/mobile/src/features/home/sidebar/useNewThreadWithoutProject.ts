import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react-native";
import { useRef } from "react";

import * as Dialog from "../../../components/ui/Dialog";
import { uuidv4 } from "../../../lib/uuid";
import { useServerConfigs } from "../../../state/entities";
import { projectEnvironment } from "../../../state/projects";
import { useAtomCommand } from "../../../state/use-atom-command";
import { useRemoteConnectionStatus } from "../../../state/use-remote-environment-registry";
import { useSelectWorkspaceDetail } from "../../layout/workspace/useSelectWorkspaceDetail";
import { resolveNewTaskScratchOption } from "../../threads/new-task-project-selection";

/**
 * The Threads pencil, as the desktop's: an empty chat without a project on the computer the
 * list shows, where the project is picked above the composer. Where no computer offers a
 * chat without a project, upstream's new thread.
 */
export function useNewThreadWithoutProject(
  selectedEnvironmentId: EnvironmentId | null,
  fallback: () => void,
) {
  const gt = useGT();
  const m = useMessages();
  const selectDetail = useSelectWorkspaceDetail();
  const serverConfigs = useServerConfigs();
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const pending = useRef(false);
  return async () => {
    const option = resolveNewTaskScratchOption({
      environments: connectedEnvironments,
      serverConfigs,
      selectedEnvironmentId,
    });
    if (option?.ready !== true) {
      fallback();
      return;
    }
    if (pending.current) return;
    pending.current = true;
    const result = await openScratch({ environmentId: option.environmentId, input: {} });
    pending.current = false;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        Dialog.alert(
          gt("Could not start without a project"),
          errorDisplayMessage(squashAtomCommandFailure(result), m) ??
            gt("The folder for threads without a project could not be created."),
        );
      return;
    }
    selectDetail({
      name: "Thread",
      params: {
        draft: {
          requestId: uuidv4(),
          environmentId: String(result.value.environmentId),
          projectId: String(result.value.id),
        },
      },
    });
  };
}
