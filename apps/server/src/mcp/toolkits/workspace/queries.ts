import { ProjectId, ThreadId } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Focused, read-only projection queries for the workspace MCP tools. They
 * read the same projection tables the app renders from and never return
 * provider session state.
 */

export interface WorkspaceProjectRow {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  /** Raw stored links; may still name deleted projects. */
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
}

export interface WorkspaceThreadRow {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly worktreePath: string | null;
  /** Raw stored links; may still name deleted projects. */
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface WorkspaceMessageRow {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export const parseProjectIdList = (value: unknown): ReadonlyArray<ProjectId> => {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string").map((id) => ProjectId.make(id))
      : [];
  } catch {
    return [];
  }
};

interface ProjectDbRow {
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly linkedProjectIds: string | null;
}

interface ThreadDbRow {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly linkedProjectIds: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

const toProjectRow = (row: ProjectDbRow): WorkspaceProjectRow => ({
  projectId: ProjectId.make(row.projectId),
  title: row.title,
  workspaceRoot: row.workspaceRoot,
  linkedProjectIds: parseProjectIdList(row.linkedProjectIds),
});

const toThreadRow = (row: ThreadDbRow): WorkspaceThreadRow => ({
  threadId: ThreadId.make(row.threadId),
  projectId: ProjectId.make(row.projectId),
  title: row.title,
  worktreePath: row.worktreePath,
  linkedProjectIds: parseProjectIdList(row.linkedProjectIds),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  archivedAt: row.archivedAt,
});

export const listActiveProjects = Effect.fn("WorkspaceQueries.listActiveProjects")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<ProjectDbRow>`
    SELECT
      project_id AS "projectId",
      title,
      workspace_root AS "workspaceRoot",
      linked_project_ids_json AS "linkedProjectIds"
    FROM projection_projects
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC, project_id ASC
  `;
  return rows.map(toProjectRow);
});

export const getActiveThread = Effect.fn("WorkspaceQueries.getActiveThread")(function* (
  threadId: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<ThreadDbRow>`
    SELECT
      thread_id AS "threadId",
      project_id AS "projectId",
      title,
      worktree_path AS "worktreePath",
      linked_project_ids_json AS "linkedProjectIds",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      archived_at AS "archivedAt"
    FROM projection_threads
    WHERE thread_id = ${threadId}
      AND deleted_at IS NULL
  `;
  const row = rows[0];
  return row === undefined ? undefined : toThreadRow(row);
});

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

// `column` is a fixed name from this module; only needles are bound parameters.
const matchesAny = (
  sql: SqlClient.SqlClient,
  column: "threads.title" | "messages.text",
  needles: ReadonlyArray<string>,
) => sql.or(needles.map((needle) => sql`instr(lower(${sql.literal(column)}), ${needle}) > 0`));

export interface SearchThreadsInput {
  readonly query: string;
  readonly projectId: ProjectId | undefined;
  readonly excludeThreadId: ThreadId | undefined;
  readonly limit: number;
}

export interface SearchThreadRow extends WorkspaceThreadRow {
  readonly projectTitle: string | null;
  readonly titleMatches: boolean;
}

export const searchThreads = Effect.fn("WorkspaceQueries.searchThreads")(function* (
  input: SearchThreadsInput,
) {
  const sql = yield* SqlClient.SqlClient;
  const needles = searchNeedles(input.query);
  const titleMatch = matchesAny(sql, "threads.title", needles);
  const messageMatch = matchesAny(sql, "messages.text", needles);
  const projectFilter =
    input.projectId === undefined
      ? sql`1 = 1`
      : sql`(
          threads.project_id = ${input.projectId}
          OR EXISTS (
            SELECT 1 FROM json_each(threads.linked_project_ids_json) AS linked
            WHERE linked.value = ${input.projectId}
          )
          OR EXISTS (
            SELECT 1 FROM json_each(projects.linked_project_ids_json) AS tagged
            WHERE tagged.value = ${input.projectId}
          )
        )`;
  const excludeFilter =
    input.excludeThreadId === undefined
      ? sql`1 = 1`
      : sql`threads.thread_id <> ${input.excludeThreadId}`;
  const rows = yield* sql<ThreadDbRow & { projectTitle: string | null; titleMatches: number }>`
    SELECT
      threads.thread_id AS "threadId",
      threads.project_id AS "projectId",
      threads.title AS "title",
      threads.worktree_path AS "worktreePath",
      threads.linked_project_ids_json AS "linkedProjectIds",
      threads.created_at AS "createdAt",
      threads.updated_at AS "updatedAt",
      threads.archived_at AS "archivedAt",
      projects.title AS "projectTitle",
      CASE WHEN ${titleMatch} THEN 1 ELSE 0 END AS "titleMatches"
    FROM projection_threads AS threads
    LEFT JOIN projection_projects AS projects
      ON projects.project_id = threads.project_id
    WHERE threads.deleted_at IS NULL
      AND ${excludeFilter}
      AND ${projectFilter}
      AND (
        ${titleMatch}
        OR EXISTS (
          SELECT 1 FROM projection_thread_messages AS messages
          WHERE messages.thread_id = threads.thread_id
            AND messages.role IN ('user', 'assistant')
            AND ${messageMatch}
        )
      )
    ORDER BY threads.updated_at DESC, threads.thread_id DESC
    LIMIT ${input.limit + 1}
  `;
  return rows.map(
    (row): SearchThreadRow => ({
      ...toThreadRow(row),
      projectTitle: row.projectTitle,
      titleMatches: Number(row.titleMatches) === 1,
    }),
  );
});

/** The earliest user/assistant message in the thread that contains the query. */
export const findFirstMatchingMessage = Effect.fn("WorkspaceQueries.findFirstMatchingMessage")(
  function* (threadId: ThreadId, query: string) {
    const sql = yield* SqlClient.SqlClient;
    const messageMatch = matchesAny(sql, "messages.text", searchNeedles(query));
    const rows = yield* sql<{ readonly text: string }>`
      SELECT messages.text AS "text"
      FROM projection_thread_messages AS messages
      WHERE messages.thread_id = ${threadId}
        AND messages.role IN ('user', 'assistant')
        AND ${messageMatch}
      ORDER BY messages.created_at ASC, messages.message_id ASC
      LIMIT 1
    `;
    return rows[0]?.text;
  },
);

export const countThreadMessages = Effect.fn("WorkspaceQueries.countThreadMessages")(function* (
  threadId: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS "count"
    FROM projection_thread_messages
    WHERE thread_id = ${threadId}
      AND role IN ('user', 'assistant')
  `;
  return Number(rows[0]?.count ?? 0);
});

/** The latest `limit` user/assistant messages, returned oldest first. */
export const listLatestThreadMessages = Effect.fn("WorkspaceQueries.listLatestThreadMessages")(
  function* (threadId: ThreadId, limit: number) {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<WorkspaceMessageRow>`
      SELECT role, text, created_at AS "createdAt"
      FROM projection_thread_messages
      WHERE thread_id = ${threadId}
        AND role IN ('user', 'assistant')
      ORDER BY created_at DESC, message_id DESC
      LIMIT ${limit}
    `;
    return rows.toReversed();
  },
);
