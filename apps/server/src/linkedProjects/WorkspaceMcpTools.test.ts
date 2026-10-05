import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type ApplicationProjectEvent,
  EnvironmentId,
  EventId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { McpServer } from "effect/unstable/ai";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ThreadToolkitRegistrationLive } from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { planThreadProjectLinks } from "../orchestration-v2/linkedProjects.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadSearch from "../orchestration-v2/ThreadSearch.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import {
  WorkspaceMcpToolsLive,
  WorkspaceToolkit,
  WorkspaceToolkitHandlersLive,
} from "./WorkspaceMcpTools.ts";

const now = "2026-01-01T00:00:00.000Z";
const home = ProjectId.make("project-home");
const docs = ProjectId.make("project-docs");
const infra = ProjectId.make("project-infra");
const scratch = ProjectId.make("project-scratch");
const callerId = ThreadId.make("thread-caller");
const instanceId = ProviderInstanceId.make("codex");

const projectCreated = (projectId: ProjectId, workspaceRoot: string): ApplicationProjectEvent => ({
  sequence: 0,
  eventId: EventId.make(`event:${projectId}`),
  aggregateKind: "project",
  aggregateId: projectId,
  occurredAt: now,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "project.created",
  payload: {
    projectId,
    title: projectId,
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  },
});

/** The calling thread, with a thread service that applies link commands like the orchestrator. */
const makeDependencies = (callerOverrides: Partial<OrchestrationV2ThreadShell> = {}) => {
  let caller = {
    id: callerId,
    projectId: home,
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    activeRunId: "run-active",
    archivedAt: null,
    deletedAt: null,
    ...callerOverrides,
  } as OrchestrationV2ThreadShell;
  const dispatched: OrchestrationV2ServerCommand[] = [];
  const database = SqlitePersistenceMemory;
  const layer = Layer.mergeAll(
    NodeCrypto.layer,
    NodeServices.layer,
    database,
    ProjectStore.layer.pipe(Layer.provide(database)),
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment"),
      threadId: callerId,
      providerSessionId: "session",
      providerInstanceId: instanceId,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: () => Effect.succeed(caller),
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          if (command.type === "thread.metadata.update") {
            const planned = planThreadProjectLinks({
              thread: caller,
              update: command,
              activeProjectIds: new Set([home, docs, infra, scratch]),
            });
            if (planned._tag === "ok") caller = { ...caller, ...planned.change };
          }
          return { sequence: dispatched.length } as never;
        }),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getByWorkspaceRoot: (workspaceRoot) =>
        Effect.succeed(
          workspaceRoot === "/work/docs" ? Option.some({ id: docs } as never) : Option.none(),
        ),
    }),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      scratchRoot: Effect.succeed(Option.some("/data/scratch")),
    }),
  );
  return { layer, dispatched };
};

const seedProjects = Effect.gen(function* () {
  const store = yield* ProjectStore.ProjectStoreV2;
  yield* store.apply(projectCreated(home, "/work/home"));
  yield* store.apply(projectCreated(docs, "/work/docs"));
  yield* store.apply(projectCreated(infra, "/work/infra"));
  yield* store.apply(projectCreated(scratch, "/data/scratch"));
});

const handle = (name: keyof (typeof WorkspaceToolkit)["tools"], params: object) =>
  Effect.gen(function* () {
    const toolkit = yield* WorkspaceToolkit;
    const results = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect);
    return results.at(-1)!;
  });

it.effect("links and unlinks projects on the calling thread by id and by folder", () => {
  const { layer, dispatched } = makeDependencies();
  return Effect.gen(function* () {
    yield* seedProjects;
    const linked = yield* handle("thread_link_project", {
      projectIds: [infra, home],
      paths: ["/work/docs"],
    });
    assert.isFalse(linked.isFailure);
    assert.deepInclude(linked.result as object, {
      linkedProjectIds: [infra, docs],
      added: [infra, docs],
    });
    assert.deepInclude(dispatched[0], { linkProjectIds: [infra, docs] });

    const unlinked = yield* handle("thread_unlink_project", { projectIds: [infra] });
    assert.deepInclude(unlinked.result as object, { linkedProjectIds: [docs], removed: [infra] });

    const unknown = yield* handle("thread_link_project", { paths: ["/work/missing"] });
    assert.isTrue(unknown.isFailure);
    const scratchLink = yield* handle("thread_link_project", { projectIds: [scratch] });
    assert.isTrue(scratchLink.isFailure);
    assert.equal(dispatched.length, 2);
  }).pipe(Effect.provide(WorkspaceToolkitHandlersLive.pipe(Layer.provideMerge(layer))));
});

it.effect("refuses links from a caller that is not full-access/default, but allows unlinks", () => {
  const { layer, dispatched } = makeDependencies({
    runtimeMode: "auto-accept-edits",
    linkedProjectIds: [docs],
  });
  return Effect.gen(function* () {
    yield* seedProjects;
    const refused = yield* handle("thread_link_project", { projectIds: [infra] });
    assert.isTrue(refused.isFailure);
    assert.deepInclude(refused.result as object, { code: "capability_denied" });
    const unlinked = yield* handle("thread_unlink_project", { projectIds: [docs] });
    assert.isFalse(unlinked.isFailure);
    assert.equal(dispatched.length, 1);
  }).pipe(Effect.provide(WorkspaceToolkitHandlersLive.pipe(Layer.provideMerge(layer))));
});

it.effect(
  "searches threads across the workspace, archived ones and linked projects included",
  () => {
    const { layer } = makeDependencies();
    return Effect.gen(function* () {
      yield* seedProjects;
      const sql = yield* SqlClient.SqlClient;
      const thread = (input: {
        readonly id: string;
        readonly projectId: ProjectId;
        readonly title: string;
        readonly updatedAt: string;
        readonly archivedAt?: string;
        readonly linkedProjectIds?: ReadonlyArray<ProjectId>;
      }) => sql`
      INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
      ) VALUES (
        ${input.id}, ${input.projectId}, ${input.title}, 'codex', 'full-access', 'default',
        NULL, ${now}, ${input.updatedAt}, ${input.archivedAt ?? null}, NULL,
        ${JSON.stringify({ linkedProjectIds: input.linkedProjectIds ?? [] })}
      )
    `;
      const message = (id: string, threadId: string, role: string, text: string) => sql`
      INSERT INTO orchestration_v2_projection_messages (
        message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json
      ) VALUES (${id}, ${threadId}, NULL, NULL, ${role}, 0, ${now}, ${now}, ${JSON.stringify({ text })})
    `;
      yield* thread({
        id: "t-docs",
        projectId: docs,
        title: "Docs work",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
      yield* thread({
        id: "t-archived",
        projectId: infra,
        title: "Old infra",
        updatedAt: "2026-01-03T00:00:00.000Z",
        archivedAt: "2026-01-04T00:00:00.000Z",
      });
      yield* thread({
        id: "t-linked",
        projectId: home,
        title: "Home task",
        updatedAt: "2026-01-05T00:00:00.000Z",
        linkedProjectIds: [docs],
      });
      yield* thread({ id: callerId, projectId: home, title: "Caller", updatedAt: now });
      yield* message("m1", "t-docs", "user", "Please fix the Kubernetes manifest");
      yield* message("m2", "t-archived", "assistant", "The kubernetes cluster is ready");
      yield* message("m3", "t-linked", "user", "Deploy to KUBERNETES today");
      yield* message("m4", callerId, "user", "kubernetes from the caller");

      const all = (yield* handle("t3_thread_search", { query: "kubernetes" })).result as {
        readonly matches: ReadonlyArray<{
          readonly threadId: string;
          readonly archived: boolean;
          readonly source: string;
        }>;
        readonly hasMore: boolean;
      };
      assert.deepEqual(
        all.matches.map((match) => [match.threadId, match.archived, match.source]),
        [
          ["t-linked", false, "user"],
          ["t-archived", true, "assistant"],
          ["t-docs", false, "user"],
        ],
      );

      const active = (yield* handle("t3_thread_search", {
        query: "kubernetes",
        includeArchived: false,
      })).result as { readonly matches: ReadonlyArray<{ readonly threadId: string }> };
      assert.deepEqual(
        active.matches.map((match) => match.threadId),
        ["t-linked", "t-docs"],
      );

      const underDocs = (yield* handle("t3_thread_search", {
        query: "kubernetes",
        projectId: docs,
      })).result as { readonly matches: ReadonlyArray<{ readonly threadId: string }> };
      assert.deepEqual(
        underDocs.matches.map((match) => match.threadId),
        ["t-linked", "t-docs"],
      );

      const byTitle = (yield* handle("t3_thread_search", { query: "old infra", limit: 1 }))
        .result as {
        readonly matches: ReadonlyArray<{ readonly source: string }>;
        readonly hasMore: boolean;
      };
      assert.deepEqual(
        byTitle.matches.map((match) => match.source),
        ["title"],
      );
      assert.isFalse(byTitle.hasMore);
    }).pipe(Effect.provide(WorkspaceToolkitHandlersLive.pipe(Layer.provideMerge(layer))));
  },
);

it.effect("replaces upstream's project-scoped t3_thread_search when registered after core", () => {
  const { layer } = makeDependencies();
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const searches = server.tools.filter(({ tool }) => tool.name === "t3_thread_search");
    assert.equal(searches.length, 1);
    assert.include(searches[0]?.tool.description, "across the whole workspace");
  }).pipe(
    Effect.provide(
      // The order McpHttpServer.layer uses: core toolkits first, then product tools.
      WorkspaceMcpToolsLive.pipe(
        Layer.provideMerge(ThreadToolkitRegistrationLive),
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(
          Layer.mergeAll(
            layer,
            Layer.mock(ThreadSearch.ThreadSearch)({}),
            Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
          ),
        ),
      ),
    ),
  );
});
