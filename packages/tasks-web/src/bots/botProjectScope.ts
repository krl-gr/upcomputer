import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";

/**
 * The bots the sidebar's Projects filter leaves in one environment's Bots section. `scope` is
 * null for All projects; otherwise its projects, without Scratch ("No project"), so that filter
 * shows no bots. A bot shows when a selected project on its own environment is the one its chat
 * lives in or one it may use.
 */
export function botsInProjectScope<B extends Pick<Bot, "projectId" | "allowedProjectIds">>(
  environmentId: EnvironmentId,
  bots: ReadonlyArray<B>,
  scope: ReadonlyArray<ScopedProjectRef> | null,
): ReadonlyArray<B> {
  if (scope === null) return bots;
  const selected = new Set(
    scope.flatMap((ref) => (ref.environmentId === environmentId ? [ref.projectId] : [])),
  );
  return bots.filter(
    (bot) => selected.has(bot.projectId) || bot.allowedProjectIds.some((id) => selected.has(id)),
  );
}
