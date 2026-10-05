import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { ProjectServiceLayerLive } from "../orchestration-v2/runtimeLayer.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

const TestLayer = ProjectServiceLayerLive.pipe(
  Layer.provideMerge(ProjectEnrichmentService.layer),
  Layer.provideMerge(
    Layer.succeed(WorkspacePaths.WorkspacePaths, {
      normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
        Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
    }),
  ),
  Layer.provideMerge(
    Layer.merge(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        resolvePath: () => Effect.succeed(null),
      }),
    ),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "project-links-test-" })),
  Layer.provide(NodeServices.layer),
);

const home = ProjectId.make("project:links-home");
const docs = ProjectId.make("project:links-docs");
const infra = ProjectId.make("project:links-infra");
const gone = ProjectId.make("project:links-gone");

it.layer(TestLayer)("project linked projects", (it) => {
  it.effect("replaces links, drops the project itself and keeps them on other updates", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      for (const projectId of [home, docs, infra, gone]) {
        yield* service.create({
          commandId: CommandId.make(`create:${projectId}`),
          projectId,
          title: projectId,
          workspaceRoot: `/work/${projectId}`,
        });
      }
      yield* service.delete({ commandId: CommandId.make("delete:gone"), projectId: gone });

      const created = Option.getOrThrow(yield* service.getById(home));
      assert.equal(created.linkedProjectIds, undefined);

      const linked = yield* service.update({
        commandId: CommandId.make("links:set"),
        projectId: home,
        linkedProjectIds: [docs, home, infra, docs],
      });
      assert.deepEqual(linked.linkedProjectIds, [docs, infra]);
      const shell = Option.getOrThrow(yield* service.getShell(home));
      assert.deepEqual(shell.linkedProjectIds, [docs, infra]);

      const renamed = yield* service.update({
        commandId: CommandId.make("links:rename"),
        projectId: home,
        title: "Home",
      });
      assert.equal(renamed.title, "Home");
      assert.deepEqual(renamed.linkedProjectIds, [docs, infra]);

      const rejected = yield* Effect.exit(
        service.update({
          commandId: CommandId.make("links:gone"),
          projectId: home,
          linkedProjectIds: [gone],
        }),
      );
      assert.equal(rejected._tag, "Failure");
      assert.deepEqual(Option.getOrThrow(yield* service.getById(home)).linkedProjectIds, [
        docs,
        infra,
      ]);

      const cleared = yield* service.update({
        commandId: CommandId.make("links:clear"),
        projectId: home,
        linkedProjectIds: [],
      });
      assert.equal(cleared.linkedProjectIds, undefined);
    }),
  );

  it.effect("records the upcomputer.core migrations under V1's names", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly version: number; readonly name: string }>`
        SELECT version, name FROM feature_migration_history
        WHERE namespace = 'upcomputer.core' ORDER BY version
      `;
      assert.deepEqual(
        rows.map((row) => `${row.version}:${row.name}`),
        ["1:ProjectionLinkedProjects", "2:ProjectionThreadProjectLinksPinned"],
      );
    }),
  );
});
