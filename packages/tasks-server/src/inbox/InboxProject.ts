import { ProjectId } from "@t3tools/contracts";
import { TaskError } from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import { makeFeatureProjects, ProjectStoreV2 } from "../../../../apps/server/src/extensionApi.ts";

export const INBOX_PROJECT_TITLE = "Inbox";
/** The Inbox project's folder, below the T3 home. */
export const INBOX_FOLDER = "tasks-inbox";

export interface InboxProjectShape {
  /**
   * The project that takes tasks created without one: a normal project titled
   * Inbox on `<T3 home>/tasks-inbox`, created on first use. Its id is kept in
   * the task settings, so renaming or moving it keeps it the Inbox; after it
   * is deleted, the next call creates it again.
   */
  readonly ensure: Effect.Effect<ProjectId, TaskError>;
}

export class InboxProject extends Context.Service<InboxProject, InboxProjectShape>()(
  "@t3tools/tasks-server/inbox/InboxProject",
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* ProjectStoreV2;
  const projects = yield* makeFeatureProjects;
  const workspaceRoot = (yield* Path.Path).join(projects.homeDir, INBOX_FOLDER);
  // Two first person tasks at once must not race to create two projects.
  const lock = yield* Semaphore.make(1);

  const ensure = Effect.gen(function* () {
    const rows = yield* sql<{ readonly inboxProjectId: string | null }>`
      SELECT inbox_project_id AS "inboxProjectId" FROM task_settings WHERE id = 1`;
    const stored = rows[0]?.inboxProjectId ?? null;
    if (stored !== null) {
      const id = ProjectId.make(stored);
      if (Option.isSome(yield* store.getShell(id))) return id;
    }
    const project = yield* projects.ensureProjectForWorkspaceRoot({
      title: INBOX_PROJECT_TITLE,
      workspaceRoot,
    });
    yield* sql`UPDATE task_settings SET inbox_project_id = ${project.id} WHERE id = 1`;
    return project.id;
  }).pipe(
    lock.withPermits(1),
    Effect.mapError(
      (cause) => new TaskError({ message: "Could not find or create the Inbox project.", cause }),
    ),
  );

  return { ensure } satisfies InboxProjectShape;
});

export const InboxProjectLive = Layer.effect(InboxProject, make);
