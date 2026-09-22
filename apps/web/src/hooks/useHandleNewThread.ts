import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@upcomputer/client-runtime/environment";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_SERVER_SETTINGS,
  type ScopedProjectRef,
} from "@upcomputer/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  DraftId,
  markPromotedDraftThreadByRef,
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import {
  deriveLogicalProjectKeyFromSettings,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { readThreadShell, useProjects, useServerConfigs, useThread } from "../state/entities";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";

export interface NewThreadOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
  startFromOrigin?: boolean;
  forceNewDraft?: boolean;
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
}

export interface CreatedDraftThread {
  draftId: DraftId;
  ref: ReturnType<typeof scopeThreadRef>;
}

export function useCreateDraftThreadState() {
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);

  return useCallback(
    (projectRef: ScopedProjectRef, options?: NewThreadOptions): CreatedDraftThread => {
      const { applyStickyState, getDraftSession, setLogicalProjectDraftThreadId } =
        useComposerDraftStore.getState();
      const project = projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      );
      const environmentSettings =
        serverConfigs.get(projectRef.environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS;
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
        : scopedProjectKey(projectRef);
      const draftId = newDraftId();
      const threadId = newThreadId();
      const initialEnvMode = options?.envMode ?? environmentSettings.defaultThreadEnvMode;

      setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
        threadId,
        createdAt: new Date().toISOString(),
        branch: options?.branch ?? null,
        worktreePath: options?.worktreePath ?? null,
        envMode: initialEnvMode,
        startFromOrigin:
          options?.startFromOrigin ??
          resolveNewDraftStartFromOrigin({
            envMode: initialEnvMode,
            newWorktreesStartFromOrigin: environmentSettings.newWorktreesStartFromOrigin,
          }),
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });
      applyStickyState(draftId);

      const session = getDraftSession(draftId);
      return {
        draftId,
        ref: scopeThreadRef(
          session?.environmentId ?? projectRef.environmentId,
          session?.threadId ?? threadId,
        ),
      };
    },
    [projectGroupingSettings, projects, serverConfigs],
  );
}

export function useNewThreadHandler() {
  const projects = useProjects();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const router = useRouter();
  const createDraftThread = useCreateDraftThreadState();
  const getCurrentRouteTarget = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
  }, [router]);

  return useCallback(
    (projectRef: ScopedProjectRef, options?: NewThreadOptions): Promise<void> => {
      const {
        getDraftSessionByLogicalProjectKey,
        getDraftSession,
        getDraftThread,
        setDraftThreadContext,
        setLogicalProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const currentRouteTarget = getCurrentRouteTarget();
      const project = projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      );
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
        : scopedProjectKey(projectRef);
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const hasStartFromOriginOption = options?.startFromOrigin !== undefined;
      const storedDraftThread = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      const storedDraftThreadRef = storedDraftThread
        ? scopeThreadRef(storedDraftThread.environmentId, storedDraftThread.threadId)
        : null;
      const reusableStoredDraftThread =
        storedDraftThreadRef && readThreadShell(storedDraftThreadRef) !== null
          ? null
          : storedDraftThread;
      if (storedDraftThreadRef && reusableStoredDraftThread === null) {
        markPromotedDraftThreadByRef(storedDraftThreadRef);
      }
      const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
        ? currentRouteTarget.kind === "server"
          ? getDraftThread(currentRouteTarget.threadRef)
          : getDraftSession(currentRouteTarget.draftId)
        : null;
      if (reusableStoredDraftThread && !options?.forceNewDraft) {
        return (async () => {
          if (
            hasBranchOption ||
            hasWorktreePathOption ||
            hasEnvModeOption ||
            hasStartFromOriginOption
          ) {
            setDraftThreadContext(reusableStoredDraftThread.draftId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
              ...(hasStartFromOriginOption ? { startFromOrigin: options?.startFromOrigin } : {}),
            });
          }
          setLogicalProjectDraftThreadId(
            logicalProjectKey,
            projectRef,
            reusableStoredDraftThread.draftId,
            {
              threadId: reusableStoredDraftThread.threadId,
            },
          );
          if (
            currentRouteTarget?.kind === "draft" &&
            currentRouteTarget.draftId === reusableStoredDraftThread.draftId
          ) {
            return;
          }
          await router.navigate({
            to: "/draft/$draftId",
            params: { draftId: reusableStoredDraftThread.draftId },
          });
        })();
      }

      if (
        !options?.forceNewDraft &&
        latestActiveDraftThread &&
        currentRouteTarget?.kind === "draft" &&
        latestActiveDraftThread.logicalProjectKey === logicalProjectKey &&
        latestActiveDraftThread.promotedTo == null
      ) {
        if (
          hasBranchOption ||
          hasWorktreePathOption ||
          hasEnvModeOption ||
          hasStartFromOriginOption
        ) {
          setDraftThreadContext(currentRouteTarget.draftId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            ...(hasStartFromOriginOption ? { startFromOrigin: options?.startFromOrigin } : {}),
          });
        }
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
          threadId: latestActiveDraftThread.threadId,
          createdAt: latestActiveDraftThread.createdAt,
          runtimeMode: latestActiveDraftThread.runtimeMode,
          interactionMode: latestActiveDraftThread.interactionMode,
          ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
          ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
          ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          ...(hasStartFromOriginOption ? { startFromOrigin: options?.startFromOrigin } : {}),
        });
        return Promise.resolve();
      }

      const created = createDraftThread(projectRef, options);
      return (async () => {
        await router.navigate({
          to: "/draft/$draftId",
          params: { draftId: created.draftId },
          replace: options?.replace ?? false,
        });
      })();
    },
    [createDraftThread, getCurrentRouteTarget, projectGroupingSettings, projects, router],
  );
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = useThread(routeThreadRef);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useProjects();
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
      getPreferenceIds: (project) => [
        getProjectOrderKey(project),
        legacyProjectCwdPreferenceKey(project.workspaceRoot),
      ],
    });
  }, [projectOrder, projects]);
  const handleNewThread = useNewThreadHandler();

  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef: orderedProjects[0]
      ? scopeProjectRef(orderedProjects[0].environmentId, orderedProjects[0].id)
      : null,
    handleNewThread,
    routeThreadRef,
  };
}
