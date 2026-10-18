import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { waitForProject } from "../state/entities";
import { retargetDraftToProject } from "./useRetargetDraftToProject";

/*
 * "or add a project" under the hero of a draft without a project: the project
 * added next takes that draft along, prompt and all. Every add path (a folder,
 * a new project, a clone) ends by opening the added project through
 * `useNewThreadHandler`, which asks `takeDraftMovingIntoProject` first and
 * otherwise would open a fresh draft there, leaving the prompt behind.
 */

let pending: {
  readonly draftId: DraftId;
  readonly knownProjectKeys: ReadonlySet<string>;
} | null = null;

/** Arms the move for projects not in `knownProjects`, the ones added from now on. */
export function moveDraftIntoNextAddedProject(
  draftId: DraftId,
  knownProjects: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
): void {
  pending = {
    draftId,
    knownProjectKeys: new Set(
      knownProjects.map((project) =>
        scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      ),
    ),
  };
}

/** Disarms the move, once the draft has a project or its hero is gone. */
export function cancelMoveDraftIntoAddedProject(draftId: DraftId): void {
  if (pending?.draftId === draftId) pending = null;
}

/**
 * The armed draft, when `projectRef` is a project added since and the draft is
 * still unsent; the move is then used up.
 */
export function takeDraftMovingIntoProject(projectRef: ScopedProjectRef): DraftId | null {
  if (pending === null || pending.knownProjectKeys.has(scopedProjectKey(projectRef))) return null;
  const { draftId } = pending;
  pending = null;
  const session = useComposerDraftStore.getState().getDraftSession(draftId);
  return session !== null && session.promotedTo == null ? draftId : null;
}

/** Moves the taken draft into the added project and opens it, in place of a fresh draft there. */
export async function openDraftMovedIntoProject(
  draftId: DraftId,
  projectRef: ScopedProjectRef,
  context: Parameters<typeof retargetDraftToProject>[2] & {
    readonly isOpen: () => boolean;
    readonly open: () => Promise<unknown>;
  },
): Promise<{ readonly draftId: DraftId; readonly threadId: ThreadId } | null> {
  // An add can report success before the project reaches this client's store.
  const project = await waitForProject(projectRef, 5_000).catch(() => null);
  const session = useComposerDraftStore.getState().getDraftSession(draftId);
  if (project === null || session === null || session.promotedTo != null) return null;
  retargetDraftToProject(draftId, project, context);
  if (!context.isOpen()) await context.open();
  return { draftId, threadId: session.threadId };
}
