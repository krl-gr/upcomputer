/**
 * Codex usage-limit stop message. The `account/rateLimits/updated` notification
 * names the windows and why the limit was reached; a failed turn with
 * `usageLimitExceeded` only carries OpenAI's own sentence.
 *
 * @module provider/Layers/codexUsageLimits
 */

interface CodexRateLimitWindow {
  readonly usedPercent: number;
  readonly resetsAt?: number | null;
  readonly windowDurationMins?: number | null;
}

/** Structural view of the generated `RateLimitSnapshot`. */
export interface CodexRateLimitSnapshot {
  readonly limitId?: string | null;
  readonly planType?: string | null;
  readonly rateLimitReachedType?: string | null;
  readonly primary?: CodexRateLimitWindow | null;
  readonly secondary?: CodexRateLimitWindow | null;
}

type CodexUsageWindowKind = "session" | "weekly" | "monthly";

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

function kindForDuration(mins: number): CodexUsageWindowKind {
  if (mins >= MONTH_MINS) return "monthly";
  if (mins >= WEEK_MINS) return "weekly";
  return "session";
}

/**
 * `primary` / `secondary` are positions, not durations. Codex usually sends
 * `windowDurationMins`; when it does not, paid plans expose the 5-hour and
 * weekly pair and Free/Go expose one monthly allowance.
 */
function codexRateLimitWindows(snapshot: CodexRateLimitSnapshot): ReadonlyArray<{
  readonly kind: CodexUsageWindowKind;
  readonly usedPercent: number;
  readonly resetsAtMs?: number;
}> {
  if (snapshot.limitId && snapshot.limitId !== "codex") return [];
  const isMonthlyPlan = snapshot.planType === "free" || snapshot.planType === "go";
  const positions = [
    [snapshot.primary, isMonthlyPlan ? MONTH_MINS : SESSION_MINS],
    [snapshot.secondary, WEEK_MINS],
  ] as const;
  return positions.flatMap(([window, fallbackMins]) => {
    if (!window || !Number.isFinite(window.usedPercent)) return [];
    const mins =
      typeof window.windowDurationMins === "number" ? window.windowDurationMins : fallbackMins;
    const resetsAt = window.resetsAt;
    return [
      {
        kind: kindForDuration(mins),
        usedPercent: window.usedPercent,
        ...(typeof resetsAt === "number" && Number.isFinite(resetsAt) && resetsAt > 0
          ? { resetsAtMs: resetsAt * 1000 }
          : {}),
      },
    ];
  });
}

/**
 * Codex sends `account/rateLimits/updated` as a partial view of the snapshot: a
 * field the update omits keeps the value observed earlier in the session, so a
 * later notification that only names the limit it reached must not drop the
 * windows an earlier one carried.
 */
export function mergeCodexRateLimits(
  previous: CodexRateLimitSnapshot | undefined,
  update: CodexRateLimitSnapshot,
): CodexRateLimitSnapshot | undefined {
  // Model-specific snapshots (such as Spark) describe a different allowance
  // and must not overwrite the main one.
  if (update.limitId && update.limitId !== "codex") return previous;
  if (!previous) return update;
  return {
    ...previous,
    ...(update.limitId !== undefined ? { limitId: update.limitId } : {}),
    ...(update.planType !== undefined ? { planType: update.planType } : {}),
    ...(update.rateLimitReachedType !== undefined
      ? { rateLimitReachedType: update.rateLimitReachedType }
      : {}),
    ...(update.primary !== undefined ? { primary: update.primary } : {}),
    ...(update.secondary !== undefined ? { secondary: update.secondary } : {}),
  };
}

/** Coarse remaining wait: `5d 5h`, `3h 20m`, `12m`. */
function formatCodexUsageLimitWait(waitMs: number): string {
  const totalMinutes = Math.ceil(waitMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
  if (hours === 0) return `${totalMinutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function codexUsageLimitNextStep(rateLimitReachedType: string | null | undefined): string {
  switch (rateLimitReachedType) {
    case "workspace_owner_credits_depleted":
    case "workspace_member_credits_depleted":
      return " The workspace has no credits to continue sooner: ask your workspace owner to add credits, or send the message again once the limit resets.";
    case "workspace_owner_usage_limit_reached":
    case "workspace_member_usage_limit_reached":
      return " The workspace spend limit is reached: ask your workspace owner to raise it, or send the message again once the limit resets.";
    default:
      return " Send the message again once the limit resets.";
  }
}

/**
 * The message a usage-limit stop shows instead of the provider sentence, which
 * on a Business workspace blames credits for a window that simply ran out. The
 * window named is the exhausted one that has yet to reset, latest first; `atIso`
 * is the stopping event's timestamp, not the wall clock.
 */
export function codexUsageLimitMessage(
  snapshot: CodexRateLimitSnapshot | undefined,
  atIso: string,
): string {
  const atMs = Date.parse(atIso);
  const windows = snapshot && Number.isFinite(atMs) ? codexRateLimitWindows(snapshot) : [];
  let reset = "";
  let latestResetMs = Number.NEGATIVE_INFINITY;
  for (const window of windows) {
    if (window.usedPercent < 100 || window.resetsAtMs === undefined) continue;
    const resetMs = window.resetsAtMs;
    if (resetMs <= atMs || resetMs <= latestResetMs) continue;
    latestResetMs = resetMs;
    reset = ` The ${window.kind} limit resets in ${formatCodexUsageLimitWait(resetMs - atMs)}.`;
  }
  return `Codex usage limit reached.${reset}${codexUsageLimitNextStep(snapshot?.rateLimitReachedType)}`;
}
