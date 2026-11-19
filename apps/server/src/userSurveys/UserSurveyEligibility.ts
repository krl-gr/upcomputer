import type { UpcomputerBuildKind } from "@t3tools/shared/upcomputerIdentity";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

const DAY_MS = 24 * 60 * 60_000;
const MIN_DAYS_SINCE_FIRST_MESSAGE = 7;
export const MIN_ACTIVE_DAYS = 3;
const COOLDOWN_DAYS = 30;

/** How the person has used agents on this computer. */
export interface UserMessageActivity {
  /** Epoch milliseconds of the first message a person sent; null before any. */
  readonly firstMessageAt: number | null;
  /** Distinct local days with a message a person sent. */
  readonly activeDays: number;
}

/**
 * Reads the activity from the thread history, so existing installs qualify at
 * once. Counts messages a person sent, not prompts from task agents or
 * automations. `utcOffsetMinutes` places each message on a local day.
 */
export const readUserMessageActivity = Effect.fn("UserSurveys.readUserMessageActivity")(function* (
  utcOffsetMinutes: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const offset = `${utcOffsetMinutes >= 0 ? "+" : ""}${Math.trunc(utcOffsetMinutes)} minutes`;
  const rows = yield* sql<{
    readonly firstAt: string | null;
    readonly activeDays: number;
  }>`
    SELECT
      MIN(created_at) AS "firstAt",
      COUNT(DISTINCT date(created_at, ${offset})) AS "activeDays"
    FROM orchestration_v2_projection_messages
    WHERE role = 'user' AND json_extract(payload_json, '$.createdBy') = 'user'
  `;
  const row = rows[0];
  const firstMessageAt = row?.firstAt ? Date.parse(row.firstAt) : Number.NaN;
  return {
    firstMessageAt: Number.isNaN(firstMessageAt) ? null : firstMessageAt,
    activeDays: row?.activeDays ?? 0,
  } satisfies UserMessageActivity;
});

/** Dev, local test and demo builds never show surveys; nightlies and releases do. */
export function surveyBuildAllowed(buildKind: UpcomputerBuildKind): boolean {
  return buildKind === "stable" || buildKind === "rc" || buildKind === "nightly";
}

/** Used for a week, on at least three days. */
export function activityQualifies(activity: UserMessageActivity, now: number): boolean {
  return (
    activity.firstMessageAt !== null &&
    now - activity.firstMessageAt >= MIN_DAYS_SINCE_FIRST_MESSAGE * DAY_MS &&
    activity.activeDays >= MIN_ACTIVE_DAYS
  );
}

/**
 * Whether `surveyId` may be asked now, apart from the activity: this survey
 * was never answered or dismissed here, and no survey was in the last 30 days.
 */
export function surveyNotHandled(
  handled: Readonly<Record<string, { readonly at: string }>>,
  surveyId: string,
  now: number,
): boolean {
  if (handled[surveyId] !== undefined) return false;
  return Object.values(handled).every((entry) => {
    const at = Date.parse(entry.at);
    return Number.isNaN(at) || now - at >= COOLDOWN_DAYS * DAY_MS;
  });
}
