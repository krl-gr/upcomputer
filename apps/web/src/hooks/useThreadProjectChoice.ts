import { scopeProjectRef } from "@upcomputer/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@upcomputer/client-runtime/state/runtime";
import type { EnvironmentProject } from "@upcomputer/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
} from "@upcomputer/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import { resolveProjectChoiceEffect } from "../lib/threadProjectLinks";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { usePendingProjectLinksStore } from "../pendingProjectLinksStore";
import { useServerConfigs } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useClientSettings } from "./useSettings";

type ProjectLike = Pick<EnvironmentProject, "id" | "environmentId" | "workspaceRoot" | "title">;

/**
 * Moves an unsent draft to another project in place: same draft id, thread
 * id, prompt, attachments and model; the working folder becomes the
 * project's, with the project's default workspace mode.
 */
export function useRetargetDraftToProject() {
  const serverConfigs = useServerConfigs();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);

  return useCallback(
    (draftId: DraftId, project: ProjectLike): boolean => {
      const store = useComposerDraftStore.getState();
      const session = store.getDraftSession(draftId);
      if (!session || session.promotedTo) return false;
      if (session.environmentId === project.environmentId && session.projectId === project.id) {
        return true;
      }
      const environmentSettings =
        serverConfigs.get(project.environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS;
      const envMode = environmentSettings.defaultThreadEnvMode;
      store.setLogicalProjectDraftThreadId(
        deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings),
        scopeProjectRef(project.environmentId, project.id),
        draftId,
        {
          branch: null,
          worktreePath: null,
          envMode,
          startFromOrigin: resolveNewDraftStartFromOrigin({
            envMode,
            newWorktreesStartFromOrigin: environmentSettings.newWorktreesStartFromOrigin,
          }),
        },
      );
      // Chat snapshots belong to the previous environment's threads.
      if (session.environmentId !== project.environmentId) {
        store.setPendingChatContexts(draftId, []);
      }
      return true;
    },
    [projectGroupingSettings, serverConfigs],
  );
}

function reportLinkFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/** Links and unlinks extra projects on a started thread. */
export function useThreadProjectLinkCommands() {
  const linkProjects = useAtomCommand(threadEnvironment.linkProjects, { reportFailure: false });
  const unlinkProjects = useAtomCommand(threadEnvironment.unlinkProjects, {
    reportFailure: false,
  });

  const link = useCallback(
    async (threadRef: ScopedThreadRef, projectIds: ReadonlyArray<ProjectId>): Promise<boolean> => {
      const [first, ...rest] = projectIds;
      if (first === undefined) return true;
      const result = await linkProjects({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, projectIds: [first, ...rest] },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          reportLinkFailure("Could not link the project", squashAtomCommandFailure(result));
        }
        return false;
      }
      return true;
    },
    [linkProjects],
  );

  const unlink = useCallback(
    async (threadRef: ScopedThreadRef, projectId: ProjectId): Promise<boolean> => {
      const result = await unlinkProjects({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, projectIds: [projectId] },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          reportLinkFailure("Could not unlink the project", squashAtomCommandFailure(result));
        }
        return false;
      }
      return true;
    },
    [unlinkProjects],
  );

  return { link, unlink };
}

/**
 * Applies a project chosen from the composer (context bar menu or an
 * `@project` mention) to the current chat. See `resolveProjectChoiceEffect`.
 */
export function useChooseProjectForChat(input: {
  readonly threadRef: ScopedThreadRef;
  readonly draftId: DraftId | null;
  readonly isServerThread: boolean;
  readonly isScratchProject: boolean;
}) {
  const { threadRef, draftId, isServerThread, isScratchProject } = input;
  const retargetDraft = useRetargetDraftToProject();
  const { link } = useThreadProjectLinkCommands();
  const addPendingLink = usePendingProjectLinksStore((store) => store.addLink);

  return useCallback(
    (project: ProjectLike & { readonly environmentId: EnvironmentId }) => {
      const effect = resolveProjectChoiceEffect({ isServerThread, isScratchProject });
      if (effect === "link") {
        void link(threadRef, [project.id]);
        return;
      }
      if (!draftId) return;
      if (effect === "retarget") {
        retargetDraft(draftId, project);
        return;
      }
      addPendingLink(draftId, { environmentId: project.environmentId, projectId: project.id });
    },
    [addPendingLink, draftId, isScratchProject, isServerThread, link, retargetDraft, threadRef],
  );
}
