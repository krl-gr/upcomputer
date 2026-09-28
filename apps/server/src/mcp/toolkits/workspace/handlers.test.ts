import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { McpSchema, McpServer } from "effect/unstable/ai";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../../config.ts";
import { OrchestrationEngineLive } from "../../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/RepositoryIdentityResolver.ts";
import { scratchWorkspaceRootFor } from "../../../project/scratchWorkspace.ts";
import { WorkspaceToolkitRegistrationLive } from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const createdAt = "2026-01-01T00:00:00.000Z";
const callerThreadId = ThreadId.make("thread-caller");
const homeProjectId = ProjectId.make("project-home");
const docsProjectId = ProjectId.make("project-docs");
const infraProjectId = ProjectId.make("project-infra");

const invocationFor = (
  threadId: ThreadId,
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["preview", "workspace"],
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-workspace-test"),
  threadId,
  providerSessionId: "provider-session-workspace-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
});

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  initializePayload: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mcp-workspace-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const EngineLayer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(OrchestrationProjectionPipelineLive),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-workspace-" })),
  Layer.provideMerge(NodeServices.layer),
);

const TestLayer = WorkspaceToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(EngineLayer),
);

const callTool = (
  name: string,
  args: Record<string, unknown>,
  invocation = invocationFor(callerThreadId),
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  });

const expectOk = (result: McpSchema.CallToolResult) => {
  assert.isFalse(result.isError, JSON.stringify(result.content));
  return result.structuredContent as Record<string, any>;
};

const expectToolError = (result: McpSchema.CallToolResult, code: string) => {
  assert.isTrue(result.isError);
  const error = (result.structuredContent as { error: { code?: string; message: string } }).error;
  assert.equal(error.code, code, error.message);
  const text = result.content[0];
  assert.equal(text?.type, "text");
  // Agents get the message only, never a pretty-printed cause.
  assert.notInclude((text as { text: string }).text, "    at ");
  return error.message;
};

const seed = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "mcp-workspace-" });
  const homeRoot = path.join(tempRoot, "home");
  const docsRoot = path.join(tempRoot, "docs");
  const infraRoot = path.join(tempRoot, "infra");
  const roots: ReadonlyArray<readonly [ProjectId, string]> = [
    [homeProjectId, homeRoot],
    [docsProjectId, docsRoot],
    [infraProjectId, infraRoot],
  ];
  for (const [projectId, workspaceRoot] of roots) {
    yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make(`cmd-create-${projectId}`),
      projectId,
      title: projectId,
      workspaceRoot,
      createdAt,
    });
  }
  const createThread = (threadId: ThreadId, projectId: ProjectId, title: string) =>
    engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`cmd-create-${threadId}`),
      threadId,
      projectId,
      title,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
    });
  yield* createThread(callerThreadId, homeProjectId, "Caller thread");
  return { homeRoot, docsRoot, infraRoot, tempRoot, createThread };
});

const insertMessage = (input: {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly createdAt: string;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
      ) VALUES (
        ${input.id}, ${input.threadId}, NULL, ${input.role}, ${input.text}, 0,
        ${input.createdAt}, ${input.createdAt}
      )
    `;
  });

it.effect("project_list reports the calling thread's project, links, tags and scratch home", () =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    yield* seed;
    const scratchRoot = scratchWorkspaceRootFor(path, config.baseDir);
    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("cmd-create-scratch"),
      projectId: ProjectId.make("project-scratch"),
      title: "No project",
      workspaceRoot: scratchRoot,
      createdAt,
    });
    yield* engine.dispatch({
      type: "thread.project.link",
      commandId: CommandId.make("cmd-link-docs"),
      threadId: callerThreadId,
      projectIds: [docsProjectId],
    });
    yield* engine.dispatch({
      type: "project.meta.update",
      commandId: CommandId.make("cmd-tag-home"),
      projectId: homeProjectId,
      linkedProjectIds: [infraProjectId],
    });

    const result = expectOk(yield* callTool("project_list", {}));
    assert.deepEqual(result.currentThread, {
      threadId: callerThreadId,
      projectId: homeProjectId,
      linkedProjectIds: [docsProjectId],
    });
    const byId = new Map<string, any>(
      result.projects.map((project: any) => [project.projectId, project]),
    );
    assert.deepInclude(byId.get(homeProjectId), {
      isCurrentThreadProject: true,
      isLinkedToCurrentThread: false,
      linkedProjectIds: [infraProjectId],
      isNoProject: false,
    });
    assert.deepInclude(byId.get(docsProjectId), {
      isCurrentThreadProject: false,
      isLinkedToCurrentThread: true,
      isTagOfCurrentThreadProject: false,
    });
    assert.deepInclude(byId.get(infraProjectId), {
      isLinkedToCurrentThread: false,
      isTagOfCurrentThreadProject: true,
    });
    assert.isTrue(byId.get("project-scratch").isNoProject);
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("project_create makes the folder, reuses existing roots, and links the thread", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig;
    const fixture = yield* seed;
    const newRoot = path.join(fixture.tempRoot, "nested", "fresh-project");

    const created = expectOk(yield* callTool("project_create", { path: newRoot }));
    assert.isTrue(created.created);
    assert.isTrue(created.folderCreated);
    assert.isTrue(created.linkedToThisThread);
    assert.equal(created.project.title, "fresh-project");
    assert.equal(created.project.workspaceRoot, newRoot);
    assert.isTrue(yield* fileSystem.exists(newRoot));

    // Same folder (spelled with a trailing separator) reuses the project.
    const reused = expectOk(
      yield* callTool("project_create", { path: `${newRoot}/`, title: "Ignored" }),
    );
    assert.isFalse(reused.created);
    assert.equal(reused.project.projectId, created.project.projectId);
    assert.equal(reused.project.title, "fresh-project");

    const list = expectOk(yield* callTool("project_list", {}));
    assert.deepEqual(list.currentThread.linkedProjectIds, [created.project.projectId]);

    // The thread's own project is reused but never linked to itself.
    const own = expectOk(yield* callTool("project_create", { path: fixture.homeRoot }));
    assert.equal(own.project.projectId, homeProjectId);
    assert.isFalse(own.linkedToThisThread);

    // Unlinked creation with an explicit title.
    const unlinked = expectOk(
      yield* callTool("project_create", {
        path: path.join(fixture.tempRoot, "other"),
        title: "Other things",
        linkToThisThread: false,
      }),
    );
    assert.equal(unlinked.project.title, "Other things");
    assert.isFalse(unlinked.linkedToThisThread);

    expectToolError(
      yield* callTool("project_create", { path: "relative/folder" }),
      "invalid_request",
    );
    expectToolError(
      yield* callTool("project_create", {
        path: path.join(fixture.tempRoot, "missing"),
        createFolder: false,
      }),
      "invalid_request",
    );
    assert.isFalse(yield* fileSystem.exists(path.join(fixture.tempRoot, "missing")));
    const scratchMessage = expectToolError(
      yield* callTool("project_create", {
        path: path.join(scratchWorkspaceRootFor(path, config.baseDir), "2026-01-01-thread"),
      }),
      "invalid_request",
    );
    assert.include(scratchMessage, "No project");
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("project_create expands ~ to the home directory", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    yield* seed;
    // Without createFolder the home directory itself must already exist.
    const result = expectOk(
      yield* callTool("project_create", {
        path: "~",
        createFolder: false,
        linkToThisThread: false,
      }),
    );
    assert.equal(result.project.workspaceRoot, path.resolve(NodeOS.homedir()));
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("thread_link_project and thread_unlink_project resolve ids and paths", () =>
  Effect.gen(function* () {
    const fixture = yield* seed;

    const linked = expectOk(
      yield* callTool("thread_link_project", {
        projectIds: [docsProjectId, homeProjectId],
        paths: [fixture.infraRoot],
      }),
    );
    assert.deepEqual(linked.linkedProjectIds, [docsProjectId, infraProjectId]);
    assert.deepEqual(linked.added, [docsProjectId, infraProjectId]);
    assert.include(linked.note, "own project");

    const again = expectOk(yield* callTool("thread_link_project", { projectIds: [docsProjectId] }));
    assert.deepEqual(again.added, []);

    const unlinked = expectOk(
      yield* callTool("thread_unlink_project", { paths: [`${fixture.docsRoot}/`] }),
    );
    assert.deepEqual(unlinked.linkedProjectIds, [infraProjectId]);
    assert.deepEqual(unlinked.removed, [docsProjectId]);

    expectToolError(yield* callTool("thread_link_project", {}), "invalid_request");
    expectToolError(
      yield* callTool("thread_link_project", { paths: [`${fixture.tempRoot}/unknown`] }),
      "not_found",
    );
    expectToolError(
      yield* callTool("thread_link_project", { projectIds: ["project-missing"] }),
      "not_found",
    );
    expectToolError(
      yield* callTool(
        "thread_link_project",
        { projectIds: [docsProjectId] },
        invocationFor(ThreadId.make("thread-gone")),
      ),
      "no_calling_thread",
    );
    expectToolError(
      yield* callTool(
        "thread_link_project",
        { projectIds: [docsProjectId] },
        invocationFor(callerThreadId, ["preview"]),
      ),
      "capability_denied",
    );
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("project_set_linked_projects replaces a project's tags", () =>
  Effect.gen(function* () {
    yield* seed;
    const tagged = expectOk(
      yield* callTool("project_set_linked_projects", {
        projectId: homeProjectId,
        linkedProjectIds: [docsProjectId, homeProjectId, docsProjectId, infraProjectId],
      }),
    );
    assert.deepEqual(tagged.linkedProjectIds, [docsProjectId, infraProjectId]);

    const cleared = expectOk(
      yield* callTool("project_set_linked_projects", {
        projectId: homeProjectId,
        linkedProjectIds: [],
      }),
    );
    assert.deepEqual(cleared.linkedProjectIds, []);

    expectToolError(
      yield* callTool("project_set_linked_projects", {
        projectId: "project-missing",
        linkedProjectIds: [],
      }),
      "not_found",
    );
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect(
  "thread_search matches titles and messages case-insensitively and filters by project",
  () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const fixture = yield* seed;
      const docsThread = ThreadId.make("thread-docs");
      const infraThread = ThreadId.make("thread-infra");
      const linkedThread = ThreadId.make("thread-linked");
      yield* fixture.createThread(docsThread, docsProjectId, "Deploy checklist");
      yield* fixture.createThread(infraThread, infraProjectId, "Kubernetes upgrade");
      yield* fixture.createThread(linkedThread, infraProjectId, "Misc notes");
      yield* engine.dispatch({
        type: "thread.project.link",
        commandId: CommandId.make("cmd-link-misc-docs"),
        threadId: linkedThread,
        projectIds: [docsProjectId],
      });
      yield* insertMessage({
        id: "m-caller",
        threadId: callerThreadId,
        role: "user",
        text: "please search for deploy",
        createdAt: "2026-01-02T00:00:00.000Z",
      });
      yield* insertMessage({
        id: "m-infra-1",
        threadId: infraThread,
        role: "assistant",
        text: `${"x".repeat(300)} We should DEPLOY the cluster after the Проверка step. ${"y".repeat(300)}`,
        createdAt: "2026-01-02T00:00:00.000Z",
      });
      yield* insertMessage({
        id: "m-infra-system",
        threadId: infraThread,
        role: "system",
        text: "hidden system note about zebras",
        createdAt: "2026-01-02T00:00:01.000Z",
      });
      yield* insertMessage({
        id: "m-linked",
        threadId: linkedThread,
        role: "user",
        text: "deploy docs later",
        createdAt: "2026-01-02T00:00:00.000Z",
      });

      const all = expectOk(yield* callTool("thread_search", { query: "Deploy" }));
      const ids = all.results.map((result: any) => result.threadId).toSorted();
      assert.deepEqual(ids, [docsThread, infraThread, linkedThread]);
      const infraResult = all.results.find((result: any) => result.threadId === infraThread);
      assert.equal(infraResult.matchedIn, "message");
      assert.include(infraResult.snippet, "DEPLOY the cluster");
      assert.isTrue(infraResult.snippet.startsWith("…"));
      assert.isBelow(infraResult.snippet.length, 300);
      const docsResult = all.results.find((result: any) => result.threadId === docsThread);
      assert.equal(docsResult.matchedIn, "title");
      assert.equal(docsResult.snippet, "Deploy checklist");

      const withCaller = expectOk(
        yield* callTool("thread_search", { query: "deploy", includeCurrentThread: true }),
      );
      assert.include(
        withCaller.results.map((result: any) => result.threadId),
        callerThreadId,
      );

      // Non-ASCII text matches regardless of case.
      const cyrillic = expectOk(yield* callTool("thread_search", { query: "ПРОВЕРКА" }));
      assert.deepEqual(
        cyrillic.results.map((result: any) => result.threadId),
        [infraThread],
      );

      // System messages are not searched.
      const system = expectOk(yield* callTool("thread_search", { query: "zebras" }));
      assert.deepEqual(system.results, []);

      // Docs membership: own project and thread links.
      const docs = expectOk(
        yield* callTool("thread_search", { query: "deploy", projectId: docsProjectId }),
      );
      assert.deepEqual(docs.results.map((result: any) => result.threadId).toSorted(), [
        docsThread,
        linkedThread,
      ]);

      // Tagging infra with docs brings its threads into docs.
      yield* engine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.make("cmd-tag-infra-docs"),
        projectId: infraProjectId,
        linkedProjectIds: [docsProjectId],
      });
      const tagged = expectOk(
        yield* callTool("thread_search", { query: "deploy", projectId: docsProjectId }),
      );
      assert.deepEqual(tagged.results.map((result: any) => result.threadId).toSorted(), [
        docsThread,
        infraThread,
        linkedThread,
      ]);

      const limited = expectOk(yield* callTool("thread_search", { query: "deploy", limit: 1 }));
      assert.lengthOf(limited.results, 1);
      assert.isTrue(limited.hasMore);

      // Deleted threads drop out.
      yield* engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("cmd-delete-docs-thread"),
        threadId: docsThread,
      });
      const afterDelete = expectOk(yield* callTool("thread_search", { query: "checklist" }));
      assert.deepEqual(afterDelete.results, []);

      const invalid = yield* callTool("thread_search", { query: "deploy", limit: 500 });
      assert.isTrue(invalid.isError);
      expectToolError(
        yield* callTool("thread_search", { query: "deploy", projectId: "project-missing" }),
        "not_found",
      );
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect("thread_read returns the latest user and assistant messages, truncated", () =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    yield* seed;
    yield* engine.dispatch({
      type: "thread.project.link",
      commandId: CommandId.make("cmd-link-docs-read"),
      threadId: callerThreadId,
      projectIds: [docsProjectId],
    });
    for (let index = 0; index < 5; index += 1) {
      yield* insertMessage({
        id: `m-read-${index}`,
        threadId: callerThreadId,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `message ${index} ${"z".repeat(200)}`,
        createdAt: `2026-01-02T00:00:0${index}.000Z`,
      });
    }
    yield* insertMessage({
      id: "m-read-system",
      threadId: callerThreadId,
      role: "system",
      text: "system",
      createdAt: "2026-01-02T00:00:09.000Z",
    });

    const result = expectOk(
      yield* callTool("thread_read", { threadId: callerThreadId, limit: 3, maxChars: 100 }),
    );
    assert.equal(result.title, "Caller thread");
    assert.equal(result.projectId, homeProjectId);
    assert.equal(result.projectTitle, homeProjectId);
    assert.deepEqual(result.linkedProjectIds, [docsProjectId]);
    assert.equal(result.totalMessageCount, 5);
    assert.deepEqual(
      result.messages.map((message: any) => message.text.slice(0, 9)),
      ["message 2", "message 3", "message 4"],
    );
    assert.deepEqual(
      result.messages.map((message: any) => message.role),
      ["user", "assistant", "user"],
    );
    assert.isTrue(result.messages.every((message: any) => message.truncated));
    assert.equal(result.messages[0].text.length, 101);

    expectToolError(yield* callTool("thread_read", { threadId: "thread-missing" }), "not_found");
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);
