import { scopeProjectRef } from "@upcomputer/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@upcomputer/contracts";
import type { DraftThreadEnvMode } from "../composerDraftStore";
import { createChatWorkspaceDraftThread } from "../workspace/chatWorkspaceController";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
  startFromOrigin: boolean;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
      forceNewDraft?: boolean;
    },
  ): Promise<void>;
}

async function startNewThreadInWorkspacePanel(
  context: ChatThreadActionContext,
  options: NewThreadOptions,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) return false;

  const created = createChatWorkspaceDraftThread({
    projectRef,
    disposition: "new-panel",
    options,
  });
  if (created) return true;

  await context.handleNewThread(projectRef, { ...options, forceNewDraft: true });
  return true;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

function buildContextualThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  return {
    branch: context.activeThread?.branch ?? context.activeDraftThread?.branch ?? null,
    worktreePath:
      context.activeThread?.worktreePath ?? context.activeDraftThread?.worktreePath ?? null,
    envMode:
      context.activeDraftThread?.envMode ??
      (context.activeThread?.worktreePath ? "worktree" : "local"),
    ...(context.activeDraftThread
      ? { startFromOrigin: context.activeDraftThread.startFromOrigin }
      : {}),
  };
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  await context.handleNewThread(projectRef, buildContextualThreadOptions(context));
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await startNewThreadInProjectFromContext(context, projectRef);
  return true;
}

export function startNewThreadInWorkspacePanelFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  return startNewThreadInWorkspacePanel(context, buildContextualThreadOptions(context));
}

export function startNewLocalThreadInWorkspacePanelFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  return startNewThreadInWorkspacePanel(context, {});
}

export async function startNewLocalThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
