import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Workspace-wide thread search for agents (V1's `thread_search`): titles and
 * finished user and assistant messages of every thread that is not deleted,
 * archived ones included. Legacy V1 transcripts that v2 has not imported yet
 * match by title only.
 */

/**
 * SQLite's lower() only folds ASCII, so the query is matched in the forms
 * non-ASCII text most often takes: as typed, lowercase, UPPERCASE, and
 * Capitalized. Each form is ASCII-folded to line up with lower(column).
 */
export const searchNeedles = (query: string): ReadonlyArray<string> => {
  const asciiLower = (value: string) => value.replace(/[A-Z]/g, (char) => char.toLowerCase());
  const lower = query.toLowerCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([query, lower, query.toUpperCase(), capitalized].map(asciiLower))];
};

const MESSAGE_TEXT = "json_extract(messages.payload_json, '$.text')";

// `column` is a fixed expression from this module; only needles are bound parameters.
const matchesAny = (
  sql: SqlClient.SqlClient,
  column: "threads.title" | typeof MESSAGE_TEXT,
  needles: ReadonlyArray<string>,
) => sql.or(needles.map((needle) => sql`instr(lower(${sql.literal(column)}), ${needle}) > 0`));

export interface SearchThreadRow {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly projectTitle: string | null;
  readonly updatedAt: string;
  readonly archived: boolean;
  readonly titleMatches: boolean;
}

/**
 * Newest threads first. A project filter matches threads of that project,
 * threads that link it, and threads whose project links it. Returns up to
 * `limit + 1` rows so callers can report more results.
 */
export const searchThreads = Effect.fn("WorkspaceQueries.searchThreads")(function* (input: {
  readonly query: string;
  readonly projectId: ProjectId | undefined;
  readonly includeArchived: boolean;
  readonly excludeThreadId: ThreadId | undefined;
  readonly limit: number;
}) {
  const sql = yield* SqlClient.SqlClient;
  const needles = searchNeedles(input.query);
  const titleMatch = matchesAny(sql, "threads.title", needles);
  const messageMatch = matchesAny(sql, MESSAGE_TEXT, needles);
  const filters = [
    sql`threads.deleted_at IS NULL`,
    ...(input.includeArchived ? [] : [sql`threads.archived_at IS NULL`]),
    ...(input.excludeThreadId === undefined
      ? []
      : [sql`threads.thread_id <> ${input.excludeThreadId}`]),
    ...(input.projectId === undefined
      ? []
      : [
          sql`(
            threads.project_id = ${input.projectId}
            OR EXISTS (
              SELECT 1 FROM json_each(threads.payload_json, '$.linkedProjectIds') AS linked
              WHERE linked.value = ${input.projectId}
            )
            OR EXISTS (
              SELECT 1 FROM json_each(projects.linked_project_ids_json) AS tagged
              WHERE tagged.value = ${input.projectId}
            )
          )`,
        ]),
  ];
  const rows = yield* sql<{
    readonly threadId: string;
    readonly projectId: string;
    readonly title: string;
    readonly projectTitle: string | null;
    readonly updatedAt: string;
    readonly archivedAt: string | null;
    readonly titleMatches: number;
  }>`
    SELECT
      threads.thread_id AS "threadId",
      threads.project_id AS "projectId",
      threads.title AS "title",
      projects.title AS "projectTitle",
      threads.updated_at AS "updatedAt",
      threads.archived_at AS "archivedAt",
      CASE WHEN ${titleMatch} THEN 1 ELSE 0 END AS "titleMatches"
    FROM orchestration_v2_projection_threads AS threads
    LEFT JOIN projection_projects AS projects
      ON projects.project_id = threads.project_id
    WHERE ${sql.and(filters)}
      AND (
        ${titleMatch}
        OR EXISTS (
          SELECT 1 FROM orchestration_v2_projection_messages AS messages
          WHERE messages.thread_id = threads.thread_id
            AND messages.streaming = 0
            AND messages.role IN ('user', 'assistant')
            AND ${messageMatch}
        )
      )
    ORDER BY threads.updated_at DESC, threads.thread_id DESC
    LIMIT ${input.limit + 1}
  `;
  return rows.map((row): SearchThreadRow => ({
    threadId: ThreadId.make(row.threadId),
    projectId: ProjectId.make(row.projectId),
    title: row.title,
    projectTitle: row.projectTitle,
    updatedAt: row.updatedAt,
    archived: row.archivedAt !== null,
    titleMatches: Number(row.titleMatches) === 1,
  }));
});

/** The earliest finished user or assistant message of the thread that contains the query. */
export const findFirstMatchingMessage = Effect.fn("WorkspaceQueries.findFirstMatchingMessage")(
  function* (threadId: ThreadId, query: string) {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly role: string; readonly text: string }>`
      SELECT messages.role AS "role", ${sql.literal(MESSAGE_TEXT)} AS "text"
      FROM orchestration_v2_projection_messages AS messages
      WHERE messages.thread_id = ${threadId}
        AND messages.streaming = 0
        AND messages.role IN ('user', 'assistant')
        AND ${matchesAny(sql, MESSAGE_TEXT, searchNeedles(query))}
      ORDER BY messages.created_at ASC, messages.message_id ASC
      LIMIT 1
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : { role: row.role === "user" ? ("user" as const) : ("assistant" as const), text: row.text };
  },
);
