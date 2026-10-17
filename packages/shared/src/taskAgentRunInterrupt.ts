/**
 * The interrupt reason the tasks server sends when it stops a thread's turn
 * because the thread's task-agent run ended. The thread timeline reads it back
 * to show the run's end instead of a user interruption. Keep the format: it is
 * stored in existing threads.
 */
export function taskAgentRunEndInterruptReason(status: string): string {
  return `Task-agent run ${status}.`;
}

const TASK_AGENT_RUN_END_REASON = /^Task-agent run ([a-z][a-z_-]*)\.$/;

/** The ended run's status, or null when another reason (a person's Stop) interrupted. */
export function parseTaskAgentRunEndInterruptReason(
  reason: string | null | undefined,
): string | null {
  if (reason === null || reason === undefined) return null;
  return TASK_AGENT_RUN_END_REASON.exec(reason)?.[1] ?? null;
}
