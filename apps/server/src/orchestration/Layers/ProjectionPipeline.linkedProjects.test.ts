import { CommandId, ProjectId, ProviderInstanceId, ThreadId } from "@upcomputer/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const engineLayer = it.layer(
  OrchestrationEngineLive.pipe(
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-projection-linked-projects-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

engineLayer("linked projects projection", (it) => {
  it.effect("persists thread links and project tags, hiding deleted projects on read", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-01-01T00:00:00.000Z";
      const home = ProjectId.make("project-link-home");
      const docs = ProjectId.make("project-link-docs");
      const infra = ProjectId.make("project-link-infra");
      const threadId = ThreadId.make("thread-link");

      for (const projectId of [home, docs, infra]) {
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make(`cmd-create-${projectId}`),
          projectId,
          title: projectId,
          workspaceRoot: `/tmp/${projectId}`,
          createdAt,
        });
      }
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-link-thread-create"),
        threadId,
        projectId: home,
        title: "Linked thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      yield* engine.dispatch({
        type: "thread.project.link",
        commandId: CommandId.make("cmd-link-thread"),
        threadId,
        projectIds: [docs, infra],
      });
      yield* engine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.make("cmd-tag-home"),
        projectId: home,
        linkedProjectIds: [docs, infra],
      });
      yield* engine.dispatch({
        type: "project.delete",
        commandId: CommandId.make("cmd-delete-infra"),
        projectId: infra,
      });

      // Storage keeps the stale id; every read drops it.
      const storedRows = yield* sql<{ readonly linked: string }>`
        SELECT linked_project_ids_json AS "linked"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.equal(storedRows[0]?.linked, `["${docs}","${infra}"]`);

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepEqual(
        shellSnapshot.threads.find((thread) => thread.id === threadId)?.linkedProjectIds,
        [docs],
      );
      assert.deepEqual(
        shellSnapshot.projects.find((project) => project.id === home)?.linkedProjectIds,
        [docs],
      );
      assert.deepEqual(
        shellSnapshot.projects.find((project) => project.id === docs)?.linkedProjectIds,
        [],
      );

      const threadShell = yield* snapshotQuery.getThreadShellById(threadId);
      assert.deepEqual(Option.getOrThrow(threadShell).linkedProjectIds, [docs]);
      const threadDetail = yield* snapshotQuery.getThreadDetailById(threadId);
      assert.deepEqual(Option.getOrThrow(threadDetail).linkedProjectIds, [docs]);
      const projectShell = yield* snapshotQuery.getProjectShellById(home);
      assert.deepEqual(Option.getOrThrow(projectShell).linkedProjectIds, [docs]);

      const snapshot = yield* snapshotQuery.getSnapshot();
      assert.deepEqual(
        snapshot.threads.find((thread) => thread.id === threadId)?.linkedProjectIds,
        [docs],
      );
      const commandReadModel = yield* snapshotQuery.getCommandReadModel();
      assert.deepEqual(
        commandReadModel.threads.find((thread) => thread.id === threadId)?.linkedProjectIds,
        [docs],
      );
      assert.deepEqual(
        commandReadModel.projects.find((project) => project.id === home)?.linkedProjectIds,
        [docs],
      );

      // Unlinking rewrites the stored set without the deleted project.
      yield* engine.dispatch({
        type: "thread.project.unlink",
        commandId: CommandId.make("cmd-unlink-thread"),
        threadId,
        projectIds: [docs],
      });
      const unlinkedRows = yield* sql<{ readonly linked: string }>`
        SELECT linked_project_ids_json AS "linked"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.equal(unlinkedRows[0]?.linked, "[]");
    }),
  );
});
