import type { ScopedProjectRef, ThreadId } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { waitForProject } from "../state/entities";
import { retargetDraftToProject } from "./useRetargetDraftToProject";

/*
 * "or add a project" under the hero of a draft without a project: the project
 * that this add creates takes that draft along, prompt and all.
 *
 * The move belongs to one add-project palette session. The hero arms it right
 * before opening the palette, the palette claims it for the exact project its
 * add created, and closing the palette disarms an unclaimed move. Only the
 * claimed project can take the draft, so other projects (another window,
 * another environment, a later add from the sidebar, an ordinary New chat)
 * never do.
 */

interface DraftMove {
  readonly draftId: DraftId;
  /** The draft's project when armed: the scratch "No project" project. */
  readonly from: ScopedProjectRef;
  readonly claimed: ScopedProjectRef | null;
}

// The live move. Each state is a fresh object, so a taken move can tell from
// identity alone whether it was cancelled or replaced while it waited.
let current: DraftMove | null = null;

const sameProject = (a: ScopedProjectRef, b: ScopedProjectRef) =>
  a.environmentId === b.environmentId && a.projectId === b.projectId;

/** Arms the move for the add-project palette about to open from `draftId`'s hero. */
export function moveDraftIntoNextAddedProject(draftId: DraftId, from: ScopedProjectRef): void {
  current = { draftId, from, claimed: null };
}

/** Cancels the move for `draftId`, including one waiting for its project: the hero is gone. */
export function cancelMoveDraftIntoAddedProject(draftId: DraftId): void {
  if (current?.draftId === draftId) current = null;
}

/** The add-project palette closed: an unclaimed move ends with it. */
export function disarmDraftMoveIntoAddedProject(): void {
  if (current !== null && current.claimed === null) current = null;
}

/** The palette's add created `projectRef`: binds the armed move to that project alone. */
export function claimDraftMoveForAddedProject(projectRef: ScopedProjectRef): void {
  if (current !== null && current.claimed === null) current = { ...current, claimed: projectRef };
}

function draftStillMovable(move: DraftMove): boolean {
  if (current !== move) return false;
  const session = useComposerDraftStore.getState().getDraftSession(move.draftId);
  return (
    session !== null &&
    session.promotedTo == null &&
    session.environmentId === move.from.environmentId &&
    session.projectId === move.from.projectId
  );
}

/** The move claimed for `projectRef`, when its draft can still move. */
export function takeDraftMovingIntoProject(projectRef: ScopedProjectRef): DraftMove | null {
  const move = current;
  if (move?.claimed == null || !sameProject(move.claimed, projectRef)) return null;
  if (draftStillMovable(move)) return move;
  current = null;
  return null;
}

/**
 * Moves the taken draft into its added project, in place of a fresh draft
 * there. Gives up silently when the user left the draft, sent it, gave it a
 * project or the move was cancelled while the project was on its way.
 */
export async function openDraftMovedIntoProject(
  move: DraftMove,
  projectRef: ScopedProjectRef,
  context: Parameters<typeof retargetDraftToProject>[2] & {
    readonly isDraftOpen: (draftId: DraftId) => boolean;
  },
): Promise<{ readonly draftId: DraftId; readonly threadId: ThreadId } | null> {
  // An add can report success before the project reaches this client's store.
  const project = await waitForProject(projectRef, 5_000).catch(() => null);
  const session = useComposerDraftStore.getState().getDraftSession(move.draftId);
  const movable = draftStillMovable(move) && context.isDraftOpen(move.draftId);
  if (current === move) current = null;
  if (project === null || session === null || !movable) return null;
  retargetDraftToProject(move.draftId, project, context);
  return { draftId: move.draftId, threadId: session.threadId };
}
