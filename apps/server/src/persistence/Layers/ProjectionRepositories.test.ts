import { ProjectId, ThreadId, TurnId, ProviderInstanceId } from "@upcomputer/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Statement from "effect/unstable/sql/Statement";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "./ProjectionThreadProposedPlans.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { ProjectionThreadProposedPlanRepository } from "../Services/ProjectionThreadProposedPlans.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadProposedPlanRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("selects the latest-turn plan before checking implementation status", () =>
    Effect.gen(function* () {
      const plans = yield* ProjectionThreadProposedPlanRepository;
      const threadId = ThreadId.make("thread-plan-status");
      const latestTurnId = TurnId.make("turn-plan-status-current");
      const firstPlan = {
        planId: "plan-status-first",
        threadId,
        turnId: latestTurnId,
        planMarkdown: "# First plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-03-24T00:00:01.000Z",
        updatedAt: "2026-03-24T00:00:01.000Z",
      };
      yield* plans.upsert(firstPlan);
      yield* plans.upsert({
        ...firstPlan,
        planId: "plan-status-implemented",
        implementedAt: "2026-03-24T00:00:02.000Z",
        createdAt: "2026-03-24T00:00:02.000Z",
        updatedAt: "2026-03-24T00:00:02.000Z",
      });
      yield* plans.upsert({
        ...firstPlan,
        planId: "plan-status-other-turn",
        turnId: TurnId.make("turn-plan-status-old"),
        updatedAt: "2026-03-24T00:00:10.000Z",
      });

      assert.isFalse(yield* plans.hasActionableByThreadId({ threadId, latestTurnId }));
      assert.isTrue(yield* plans.hasActionableByThreadId({ threadId, latestTurnId: null }));

      yield* plans.upsert({ ...firstPlan, updatedAt: "2026-03-24T00:00:03.000Z" });
      assert.isTrue(yield* plans.hasActionableByThreadId({ threadId, latestTurnId }));
    }),
  );

  it.effect("falls back within the thread when the latest turn has no plan", () =>
    Effect.gen(function* () {
      const plans = yield* ProjectionThreadProposedPlanRepository;
      const threadId = ThreadId.make("thread-plan-fallback");
      const latestTurnId = TurnId.make("turn-plan-fallback-missing");
      assert.isFalse(yield* plans.hasActionableByThreadId({ threadId, latestTurnId }));
      assert.isFalse(yield* plans.hasActionableByThreadId({ threadId, latestTurnId: null }));

      const firstPlan = {
        planId: "plan-fallback-without-turn",
        threadId,
        turnId: null,
        planMarkdown: "# Old plan",
        implementedAt: "2026-03-24T00:00:01.000Z",
        implementationThreadId: null,
        createdAt: "2026-03-24T00:00:01.000Z",
        updatedAt: "2026-03-24T00:00:01.000Z",
      };
      yield* plans.upsert(firstPlan);
      yield* plans.upsert({
        ...firstPlan,
        planId: "plan-fallback-with-turn",
        turnId: TurnId.make("turn-plan-fallback-old"),
        implementedAt: null,
        updatedAt: "2026-03-24T00:00:02.000Z",
      });
      yield* plans.upsert({
        ...firstPlan,
        planId: "plan-fallback-other-thread",
        threadId: ThreadId.make("thread-plan-fallback-other"),
        turnId: latestTurnId,
        updatedAt: "2026-03-24T00:00:03.000Z",
      });

      assert.isTrue(yield* plans.hasActionableByThreadId({ threadId, latestTurnId }));
      assert.isTrue(yield* plans.hasActionableByThreadId({ threadId, latestTurnId: null }));
    }),
  );

  it.effect("preserves locale ordering and stable ties when selecting plan status", () =>
    Effect.gen(function* () {
      const plans = yield* ProjectionThreadProposedPlanRepository;
      const timestamp = "2026-03-24T00:00:00.000Z";
      const cases = [
        {
          name: "mixed-case-ids",
          expected: "plan-A".localeCompare("plan-a") > 0,
          rows: [
            {
              planId: "plan-a",
              implementedAt: timestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            { planId: "plan-A", implementedAt: null, createdAt: timestamp, updatedAt: timestamp },
          ],
        },
        {
          name: "equivalent-ids",
          expected: true,
          rows: [
            {
              planId: "plan-\u00e9",
              implementedAt: timestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            {
              planId: "plan-e\u0301",
              implementedAt: null,
              createdAt: "2026-03-24T00:00:01.000Z",
              updatedAt: timestamp,
            },
          ],
        },
        {
          name: "timestamp-formats",
          expected: "2026-03-24T00:00:00+00:00".localeCompare("2026-03-24T00:00:00-01:00") > 0,
          rows: [
            {
              planId: "plan-minus",
              implementedAt: timestamp,
              createdAt: timestamp,
              updatedAt: "2026-03-24T00:00:00-01:00",
            },
            {
              planId: "plan-plus",
              implementedAt: null,
              createdAt: timestamp,
              updatedAt: "2026-03-24T00:00:00+00:00",
            },
          ],
        },
      ];
      for (const testCase of cases) {
        const threadId = ThreadId.make(`thread-plan-order-${testCase.name}`);
        const latestTurnId = TurnId.make(`turn-plan-order-${testCase.name}`);
        for (const plan of testCase.rows) {
          yield* plans.upsert({
            ...plan,
            planId: `${testCase.name}-${plan.planId}`,
            threadId,
            turnId: latestTurnId,
            planMarkdown: "# Plan",
            implementationThreadId: null,
          });
        }
        assert.strictEqual(
          yield* plans.hasActionableByThreadId({ threadId, latestTurnId }),
          testCase.expected,
          testCase.name,
        );
        assert.strictEqual(
          yield* plans.hasActionableByThreadId({ threadId, latestTurnId: null }),
          testCase.expected,
          testCase.name,
        );
      }
    }),
  );

  it.effect("returns only current-turn status metadata when old plans have large bodies", () =>
    Effect.gen(function* () {
      const plans = yield* ProjectionThreadProposedPlanRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-plan-metadata");
      const latestTurnId = TurnId.make("turn-plan-metadata-current");
      const updatedAt = "2026-03-24T00:00:00.000Z";
      yield* sql`
        WITH RECURSIVE history(n) AS (
          SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 256
        )
        INSERT INTO projection_thread_proposed_plans (
          plan_id, thread_id, turn_id, plan_markdown, implemented_at,
          implementation_thread_id, created_at, updated_at
        )
        SELECT 'plan-metadata-old-' || n, ${threadId}, 'turn-plan-metadata-old',
          ${"# Old plan\n".repeat(1024)}, ${updatedAt}, NULL, ${updatedAt}, ${updatedAt}
        FROM history
      `;
      yield* plans.upsert({
        planId: "plan-metadata-current",
        threadId,
        turnId: latestTurnId,
        planMarkdown: "# Current plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: updatedAt,
        updatedAt,
      });
      const statements: Array<Statement.Statement<unknown>> = [];
      const actionable = yield* plans.hasActionableByThreadId({ threadId, latestTurnId }).pipe(
        Effect.provideService(Statement.CurrentTransformer, (statement) => {
          statements.push(statement);
          return Effect.succeed(statement);
        }),
      );
      assert.isTrue(actionable);
      assert.strictEqual(statements.length, 1);
      const statement = statements[0];
      if (statement === undefined) return yield* Effect.die("Expected a plan status query.");
      assert.deepEqual(yield* statement, [
        { planId: "plan-metadata-current", implementedAt: null, updatedAt },
      ]);
    }),
  );

  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.make("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        scripts: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_projects row to exist.");
      }

      assert.strictEqual(
        row.defaultModelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
      );

      const persisted = yield* projects.getById({
        projectId: ProjectId.make("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-null-options"),
        projectId: ProjectId.make("project-null-options"),
        title: "Null options thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_threads row to exist.");
      }

      assert.strictEqual(
        row.modelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      });
    }),
  );

  it.effect("round-trips non-null snooze values through the thread row", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-settled"),
        projectId: ProjectId.make("project-1"),
        title: "Settled thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        archivedAt: null,
        snoozedUntil: "2026-03-26T09:00:00.000Z",
        snoozedAt: "2026-03-25T00:00:00.000Z",
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const row = Option.getOrNull(persisted);
      if (!row) {
        return yield* Effect.die("Expected settled projection_threads row to exist.");
      }
      assert.strictEqual(row.snoozedUntil, "2026-03-26T09:00:00.000Z");
      assert.strictEqual(row.snoozedAt, "2026-03-25T00:00:00.000Z");

      // Wake the snooze; confirm the flip persists.
      yield* threads.upsert({
        ...row,
        snoozedUntil: null,
        snoozedAt: null,
      });
      const repersisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const updated = Option.getOrNull(repersisted);
      assert.strictEqual(updated?.snoozedUntil, null);
      assert.strictEqual(updated?.snoozedAt, null);
    }),
  );
});
