import { assert, describe, it } from "@effect/vitest";
import {
  type ApplicationProjectEvent,
  CommandId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import {
  collectLinkedProjectIds,
  planThreadProjectLinks,
  resolveLinkedProjectDirectories,
} from "./linkedProjects.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for link commands"),
} as ProviderAdapterV2Shape;
const database = SqlitePersistenceMemory;
const testLayer = Layer.mergeAll(
  database,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  ProjectStore.layer.pipe(Layer.provide(database)),
  makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "linked-projects" },
    ProviderAdapterRegistry.makeLayer([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);

const home = ProjectId.make("project-home");
const docs = ProjectId.make("project-docs");
const infra = ProjectId.make("project-infra");
const gone = ProjectId.make("project-gone");
const now = "2026-01-01T00:00:00.000Z";

const projectEvent = (
  projectId: ProjectId,
  event:
    | { readonly type: "project.created" }
    | { readonly type: "project.deleted" }
    | {
        readonly type: "project.meta-updated";
        readonly linkedProjectIds: ReadonlyArray<ProjectId>;
      },
): ApplicationProjectEvent => {
  const base = {
    sequence: 0,
    eventId: EventId.make(`event:${projectId}:${event.type}`),
    aggregateKind: "project" as const,
    aggregateId: projectId,
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  };
  switch (event.type) {
    case "project.created":
      return {
        ...base,
        type: event.type,
        payload: {
          projectId,
          title: projectId,
          workspaceRoot: `/work/${projectId}`,
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      };
    case "project.deleted":
      return { ...base, type: event.type, payload: { projectId, deletedAt: now } };
    case "project.meta-updated":
      return {
        ...base,
        type: event.type,
        payload: { projectId, linkedProjectIds: event.linkedProjectIds, updatedAt: now },
      };
  }
};

const seed = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    for (const projectId of [home, docs, infra, gone]) {
      yield* projects.apply(projectEvent(projectId, { type: "project.created" }));
    }
    yield* projects.apply(projectEvent(gone, { type: "project.deleted" }));
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId: home,
      title: "Linked",
      modelSelection: { instanceId, model: "gpt-5.1-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    return orchestrator;
  });

let commandCounter = 0;
const links = (
  threadId: ThreadId,
  update: {
    readonly linkProjectIds?: ReadonlyArray<ProjectId>;
    readonly unlinkProjectIds?: ReadonlyArray<ProjectId>;
  },
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make(`links:${++commandCounter}`),
      threadId,
      ...update,
    });
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    return {
      thread: (yield* projections.getThreadProjection(threadId)).thread,
      shell: yield* projections.getThreadShell(threadId),
    };
  });

it.layer(testLayer)("thread project links", (it) => {
  it.effect("link adds deduped projects, skips the own project and reaches the shell", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread:links-add");
      yield* seed(threadId);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const before = (yield* projections.getThreadProjection(threadId)).thread;
      assert.equal(before.linkedProjectIds, undefined);

      const linked = yield* links(threadId, { linkProjectIds: [docs, home, docs] });
      assert.deepEqual(linked.thread.linkedProjectIds, [docs]);
      assert.deepEqual(linked.shell?.linkedProjectIds, [docs]);
      assert.equal(linked.thread.projectLinksPinned, undefined);
      // Linking is not thread activity.
      assert.equal(linked.thread.updatedAt.toString(), before.updatedAt.toString());

      const more = yield* links(threadId, { linkProjectIds: [infra, docs] });
      assert.deepEqual(more.thread.linkedProjectIds, [docs, infra]);
    }),
  );

  it.effect("unlink removes projects and pins the set against auto-linking", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread:links-remove");
      yield* seed(threadId);
      yield* links(threadId, { linkProjectIds: [docs, infra] });
      const unlinked = yield* links(threadId, { unlinkProjectIds: [docs, gone] });
      assert.deepEqual(unlinked.thread.linkedProjectIds, [infra]);
      assert.deepEqual(unlinked.shell?.linkedProjectIds, [infra]);
      assert.equal(unlinked.thread.projectLinksPinned, true);
      const relinked = yield* links(threadId, { linkProjectIds: [docs] });
      assert.deepEqual(relinked.thread.linkedProjectIds, [infra, docs]);
      assert.equal(relinked.thread.projectLinksPinned, true);
    }),
  );

  it.effect("rejects links to unknown or deleted projects", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread:links-reject");
      const orchestrator = yield* seed(threadId);
      for (const projectId of [gone, ProjectId.make("project-missing")]) {
        const exit = yield* Effect.exit(
          orchestrator.dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`links-reject:${projectId}`),
            threadId,
            linkProjectIds: [projectId],
          }),
        );
        assert.equal(exit._tag, "Failure");
      }
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      assert.equal(
        (yield* projections.getThreadProjection(threadId)).thread.linkedProjectIds,
        undefined,
      );
    }),
  );

  it.effect("drops links to projects deleted since on the next change", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread:links-heal");
      yield* seed(threadId);
      yield* links(threadId, { linkProjectIds: [docs] });
      const projects = yield* ProjectStore.ProjectStoreV2;
      yield* projects.apply(projectEvent(docs, { type: "project.deleted" }));
      const relinked = yield* links(threadId, { linkProjectIds: [infra] });
      assert.deepEqual(relinked.thread.linkedProjectIds, [infra]);
    }),
  );

  it.effect("a rename with links still counts as activity and keeps the title change", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread:links-rename");
      yield* seed(threadId);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("links-rename"),
        threadId,
        title: "Renamed",
        linkProjectIds: [docs],
      });
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const thread = (yield* projections.getThreadProjection(threadId)).thread;
      assert.equal(thread.title, "Renamed");
      assert.deepEqual(thread.linkedProjectIds, [docs]);
    }),
  );
});

describe("linked project helpers", () => {
  it("plans link sets without touching the own project", () => {
    const planned = planThreadProjectLinks({
      thread: { projectId: home, linkedProjectIds: [docs, gone] },
      update: { linkProjectIds: [home, infra] },
      activeProjectIds: new Set([home, docs, infra]),
    });
    assert.deepEqual(planned, { _tag: "ok", change: { linkedProjectIds: [docs, infra] } });
  });

  it("collects thread links before project links, without the own project", () => {
    assert.deepEqual(
      collectLinkedProjectIds({
        thread: { projectId: home, linkedProjectIds: [docs, home] },
        threadProject: { linkedProjectIds: [infra, docs] },
      }),
      [docs, infra],
    );
  });

  it("resolves folders of active linked projects, skipping the cwd and duplicates", () => {
    assert.deepEqual(
      resolveLinkedProjectDirectories({
        linkedProjectIds: [docs, gone, infra, home],
        projects: [
          { projectId: home, workspaceRoot: "/work/home", deletedAt: null },
          { projectId: docs, workspaceRoot: "/work/docs", deletedAt: null },
          { projectId: gone, workspaceRoot: "/work/gone", deletedAt: now },
          { projectId: infra, workspaceRoot: "/work/docs/", deletedAt: null },
        ],
        cwd: "/work/home",
      }),
      ["/work/docs"],
    );
  });
});

const runtimePolicyLayer = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(
    Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: () => Effect.succeed(undefined),
      listInstances: Effect.succeed([]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provideMerge(ProjectStore.layer),
  Layer.provide(SqlitePersistenceMemory),
);

it.layer(runtimePolicyLayer)("linked project folders in the runtime policy", (it) => {
  it.effect("grants thread and project links, skipping deleted projects", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectStore.ProjectStoreV2;
      for (const projectId of [home, docs, infra, gone]) {
        yield* projects.apply(projectEvent(projectId, { type: "project.created" }));
      }
      yield* projects.apply(
        projectEvent(home, { type: "project.meta-updated", linkedProjectIds: [infra] }),
      );
      yield* projects.apply(projectEvent(gone, { type: "project.deleted" }));
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const at = yield* DateTime.now;
      const threadId = ThreadId.make("thread:policy-links");
      const resolved = yield* policy.resolve({
        thread: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: home,
          title: "Policy",
          providerInstanceId: instanceId,
          modelSelection: { instanceId, model: "gpt-5.1-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          linkedProjectIds: [docs, gone],
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: at,
          updatedAt: at,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
        modelSelection: { instanceId, model: "gpt-5.1-codex" },
      });
      assert.equal(resolved.cwd, "/work/project-home");
      assert.deepEqual(resolved.additionalDirectories, [
        "/work/project-docs",
        "/work/project-infra",
      ]);
    }),
  );
});
