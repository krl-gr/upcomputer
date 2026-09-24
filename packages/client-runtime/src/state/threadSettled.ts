import type { OrchestrationThreadShell } from "@upcomputer/contracts";

/**
 * A queued turn start lives for at most this long: session adoption takes
 * seconds, so a user message still unadopted after the grace window is a
 * failed start (or stale data — shells from older servers can carry user
 * messages with no latestTurn at all), not pending work. Without this bound
 * such threads would be permanently unsnoozable.
 */
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

/**
 * A user message no turn has picked up yet: the turn.start command was
 * dispatched (message-sent + turn-start-requested) but no session has
 * adopted it, so `session` is still null and the pending work is invisible
 * to the session-status checks. Detectable as a user message strictly newer
 * than every timestamp on the latest turn — on adoption the new turn's
 * requestedAt equals the message time, clearing the condition — and only
 * within the adoption grace window.
 */
export function hasQueuedTurnStart(
  shell: Pick<OrchestrationThreadShell, "latestUserMessageAt" | "latestTurn" | "session">,
  options: { readonly now: string },
): boolean {
  if (shell.latestUserMessageAt == null) return false;
  // A failed session start clears the queued state: the failure is already
  // visible (status edge / error).
  if (shell.session?.status === "error") return false;
  const messageAt = Date.parse(shell.latestUserMessageAt);
  if (Number.isNaN(messageAt)) return false;
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) return false;
  // Bounded on both sides: message timestamps originate on whichever device
  // sent the message, so a clock ahead of this one yields a negative age
  // that would otherwise hold the queued state for the whole skew. Mirrors
  // the decider's guard.
  if (Math.abs(nowMs - messageAt) > QUEUED_TURN_START_GRACE_MS) return false;
  const turn = shell.latestTurn;
  if (turn === null) return true;
  return [turn.requestedAt, turn.startedAt, turn.completedAt].every(
    (candidate) => candidate == null || Date.parse(candidate) < messageAt,
  );
}

/**
 * The snooze lifecycle fields plus everything needed to detect a raised
 * hand. Snooze is an overlay on the active state: a snoozed thread stays
 * "active" in the data model and is only suppressed from the inbox until
 * its wake time passes or the thread demands attention.
 */
export type ThreadSnoozeShell = Pick<
  OrchestrationThreadShell,
  | "snoozedUntil"
  | "snoozedAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "session"
  | "latestTurn"
>;

/**
 * A snoozed thread "raises its hand" when something happens that outranks
 * the user's snooze: the agent is blocked on them (approval / user input),
 * the session failed, or a run completed after the snooze was set — the
 * v1 taste of event-based snooze ("something happened" wakes early).
 * Raising a hand never clears the server-side snooze fields; it only stops
 * the thread from CLASSIFYING as snoozed.
 */
export function threadRaisedHandWhileSnoozed(shell: ThreadSnoozeShell): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return true;
  // Only a FRESH failure raises the hand: a thread snoozed while already
  // failed stays snoozed — that snooze was the user saying "I saw it, not
  // now". session.updatedAt stamps the status edge, so an error newer than
  // the snooze is new information.
  if (
    shell.session?.status === "error" &&
    (shell.snoozedAt == null || Date.parse(shell.session.updatedAt) > Date.parse(shell.snoozedAt))
  ) {
    return true;
  }
  if (
    shell.snoozedAt != null &&
    shell.latestTurn?.state === "completed" &&
    shell.latestTurn.completedAt != null &&
    Date.parse(shell.latestTurn.completedAt) > Date.parse(shell.snoozedAt)
  ) {
    return true;
  }
  return false;
}

/**
 * A thread may be snoozed unless the agent is blocked on the user: hiding a
 * pending approval or user-input request defeats the request, and a queued
 * turn start (a message no turn has adopted yet) is invisible pending work.
 * A running session IS snoozable — snooze
 * only affects visibility, never the agent. Client-side twin of the server
 * invariants so the UI can reject before a round trip.
 */
export function canSnooze(
  shell: Pick<
    OrchestrationThreadShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "latestUserMessageAt" | "latestTurn" | "session"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return false;
  if (hasQueuedTurnStart(shell, options)) return false;
  return true;
}

/**
 * Snoozed resolution: hidden from the inbox while the wake time is in the
 * future and the thread has not raised its hand. Timer wakes are derived —
 * no server event fires when snoozedUntil passes; the stale fields simply
 * stop classifying as snoozed (and feed the woke indicator until the user
 * visits or re-engages).
 */
export function effectiveSnoozed(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): boolean {
  if (shell.snoozedUntil == null) return false;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  // Malformed data never hides a thread.
  if (Number.isNaN(wakeAtMs)) return false;
  if (wakeAtMs <= Date.parse(options.now)) return false;
  return !threadRaisedHandWhileSnoozed(shell);
}

/**
 * When a previously-snoozed thread woke, or null if it never snoozed / is
 * still snoozed. Used for the "Woke" indicator: the thread reappears in its
 * original sort position (the inbox sort is deliberately static), so the
 * wake signal has to carry the weight. Compare against the client's
 * lastVisitedAt — visiting clears the indicator like it clears unread.
 *
 * Timer wakes report the wake time itself; raised-hand wakes report the
 * triggering timestamp so a visit BEFORE the early wake doesn't suppress
 * the indicator.
 */
export function threadWokeAt(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): string | null {
  if (shell.snoozedUntil == null) return null;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) return null;
  // An early hand-raise wake stays authoritative even after the scheduled
  // wake time passes: reporting snoozedUntil then would resurface a Woke
  // indicator the user already cleared by visiting (snoozedUntil is newer
  // than that visit's lastVisitedAt).
  if (threadRaisedHandWhileSnoozed(shell)) {
    if (
      shell.snoozedAt != null &&
      shell.latestTurn?.state === "completed" &&
      shell.latestTurn.completedAt != null &&
      Date.parse(shell.latestTurn.completedAt) > Date.parse(shell.snoozedAt)
    ) {
      return shell.latestTurn.completedAt;
    }
    return shell.session?.updatedAt ?? shell.snoozedAt ?? null;
  }
  // No raised hand: woke iff the timer elapsed (still-snoozed → null).
  return wakeAtMs <= Date.parse(options.now) ? shell.snoozedUntil : null;
}
