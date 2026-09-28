import { scopeProjectRef } from "@upcomputer/client-runtime/environment";
import { isScratchProject } from "@upcomputer/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@upcomputer/client-runtime/state/runtime";
import type { EnvironmentProject } from "@upcomputer/client-runtime/state/shell";
import type { EnvironmentId } from "@upcomputer/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useServerConfigs, waitForProject } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { createChatWorkspaceDraftThread } from "../workspace/chatWorkspaceController";
import { type NewThreadOptions, useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not start a chat without a project",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/** Whether a project is its environment's hidden "No project" home. */
export function useIsScratchProject() {
  const serverConfigs = useServerConfigs();
  return useCallback(
    (project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot">): boolean =>
      isScratchProject(project, serverConfigs.get(project.environmentId)?.scratchWorkspaceRoot),
    [serverConfigs],
  );
}

/**
 * Chats without a project live in the environment's scratch project, a plain
 * folder the server owns (users see it as "No project"). The server creates it
 * on first use, and every chat started in it gets its own subfolder.
 */
export function useScratchProject() {
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const ensureScratch = useAtomCommand(projectEnvironment.ensureScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  /** The environment new chats without a project start on, or null when none offers it. */
  const scratchEnvironmentId = useCallback(
    (preferred: EnvironmentId | null = primaryEnvironmentId): EnvironmentId | null => {
      if (preferred !== null && serverConfigs.get(preferred)?.scratchWorkspaceRoot) {
        return preferred;
      }
      const offering = [...serverConfigs.entries()].filter(
        ([, config]) => config.scratchWorkspaceRoot !== undefined,
      );
      return offering.length === 1 ? (offering[0]?.[0] ?? null) : null;
    },
    [primaryEnvironmentId, serverConfigs],
  );

  /** Resolves to the scratch project once it is in this client's store. */
  const openScratchProject = useCallback(
    async (environmentId: EnvironmentId): Promise<EnvironmentProject | null> => {
      const result = await ensureScratch({ environmentId, input: {} });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          reportScratchFailure(squashAtomCommandFailure(result));
        }
        return null;
      }
      // Drafts key off the project's stored path and settings, so wait for
      // the create event to reach the store before targeting one.
      return waitForProject(scopeProjectRef(environmentId, result.value.projectId)).catch(
        (error: unknown) => {
          reportScratchFailure(error);
          return null;
        },
      );
    },
    [ensureScratch],
  );

  /**
   * Opens a new chat without a project. Resolves false when none could be
   * started. `inNewPanel` opens a fresh draft in a new workspace panel, like
   * the `chat.new` shortcut always has.
   */
  const startScratchThread = useCallback(
    async (
      options?: NewThreadOptions & {
        environmentId?: EnvironmentId | null;
        inNewPanel?: boolean;
        /** Workspace group the new panel opens next to (with `inNewPanel`). */
        referenceGroupId?: string;
      },
    ) => {
      const environmentId = scratchEnvironmentId(options?.environmentId ?? primaryEnvironmentId);
      if (environmentId === null) {
        reportScratchFailure(new Error("No connected machine offers chats without a project."));
        return false;
      }
      const project = await openScratchProject(environmentId);
      if (!project) return false;
      const {
        environmentId: _environmentId,
        inNewPanel,
        referenceGroupId,
        ...threadOptions
      } = options ?? {};
      const projectRef = scopeProjectRef(project.environmentId, project.id);
      if (inNewPanel) {
        // Explicit nulls: a new panel otherwise inherits the active chat's
        // branch and worktree, which belong to another project.
        const created = createChatWorkspaceDraftThread({
          projectRef,
          disposition: "new-panel",
          ...(referenceGroupId ? { referenceGroupId } : {}),
          options: { envMode: "local", branch: null, worktreePath: null, startFromOrigin: false },
        });
        if (created) return true;
      }
      await handleNewThread(projectRef, {
        ...threadOptions,
        ...(inNewPanel ? { forceNewDraft: true } : {}),
        branch: null,
        worktreePath: null,
        envMode: "local",
      }).catch(reportScratchFailure);
      return true;
    },
    [handleNewThread, openScratchProject, primaryEnvironmentId, scratchEnvironmentId],
  );

  return { scratchEnvironmentId, openScratchProject, startScratchThread };
}
