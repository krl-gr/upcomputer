import * as NodeOS from "node:os";

import {
  OrchestratorMcpFailure,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpServer, Tool, Toolkit } from "effect/unstable/ai";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { newCommandId, readCaller, readMutationCaller, unavailable } from "../mcp/threadAccess.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Queries from "./workspaceQueries.ts";

/**
 * Workspace tools for agents, on the core MCP server: link and unlink projects
 * to the calling thread, and search threads across the whole workspace.
 * `t3_thread_search` replaces upstream's same-named tool, which only searches
 * the calling project. Projects themselves use upstream's `t3_project_*`
 * tools; `t3_project_update` sets a project's linked projects.
 */

const described = <S extends Schema.Top>(schema: S, description: string) =>
  schema.annotate({ description }) as S;
const optionalDescribed = <S extends Schema.Top>(schema: S, description: string) =>
  Schema.optional(described(schema, description));

const IdInput = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty());
const PathInput = Schema.String.check(Schema.isNonEmpty());
const ProjectIdList = Schema.Array(ProjectId);

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ProjectStore.ProjectStoreV2,
  ProjectService.ProjectService,
  ManagedProjectFolders.ManagedProjectFolders,
  SqlClient.SqlClient,
  Crypto.Crypto,
  Path.Path,
];

const threadLinkParameters = Schema.Struct({
  projectIds: optionalDescribed(
    Schema.Array(IdInput),
    "Project ids from t3_project_list. Combined with paths.",
  ),
  paths: optionalDescribed(
    Schema.Array(PathInput),
    "Project folders (absolute or starting with ~), resolved to registered projects. Combined with projectIds; unknown folders are an error.",
  ),
});

const ThreadLinksResult = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  linkedProjectIds: ProjectIdList,
  added: ProjectIdList,
  removed: ProjectIdList,
  note: Schema.String,
});

const ThreadLinkProjectTool = Tool.make("thread_link_project", {
  description:
    "Link projects to this thread, so it also shows under them in the sidebar and their folders become available to this agent from its next turn. Pass projectIds and/or paths. Register a new folder first with t3_project_create. Requires a full-access/default caller.",
  parameters: threadLinkParameters,
  success: ThreadLinksResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Link projects to this thread")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ThreadUnlinkProjectTool = Tool.make("thread_unlink_project", {
  description:
    "Unlink projects from this thread. Pass projectIds and/or paths. The thread's own project cannot be unlinked, and links from its project's linked projects stay (change those with t3_project_update). After an unlink, writes no longer link projects automatically.",
  parameters: threadLinkParameters,
  success: ThreadLinksResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Unlink projects from this thread")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const THREAD_SEARCH_DEFAULT_LIMIT = 20;
const THREAD_SEARCH_MAX_LIMIT = 50;

const ThreadSearchTool = Tool.make("t3_thread_search", {
  description:
    "Search threads across the whole workspace, archived ones included, by case-insensitive text in their titles and user/assistant messages. Optionally restrict to threads that belong to a project directly, by a thread link, or through the project's linked projects. Returns newest threads first with a snippet around the first match; read one with t3_thread_read.",
  parameters: Schema.Struct({
    query: described(
      Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(500)),
      "Text to look for (substring, case-insensitive).",
    ),
    projectId: optionalDescribed(IdInput, "Only search threads that belong to this project."),
    limit: optionalDescribed(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: THREAD_SEARCH_MAX_LIMIT })),
      `Maximum threads to return, 1-${THREAD_SEARCH_MAX_LIMIT}. Defaults to ${THREAD_SEARCH_DEFAULT_LIMIT}.`,
    ),
    includeArchived: optionalDescribed(
      Schema.Boolean,
      "Include archived threads. Defaults to true.",
    ),
    includeCurrentThread: optionalDescribed(
      Schema.Boolean,
      "Include this thread in the results. Defaults to false.",
    ),
  }),
  success: Schema.Struct({
    matches: Schema.Array(
      Schema.Struct({
        threadId: ThreadId,
        title: Schema.String,
        projectId: ProjectId,
        projectTitle: Schema.NullOr(Schema.String),
        updatedAt: Schema.String,
        archived: Schema.Boolean,
        source: Schema.Literals(["title", "user", "assistant"]),
        snippet: Schema.String,
      }),
    ),
    hasMore: Schema.Boolean,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Search threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const WorkspaceToolkit = Toolkit.make(
  ThreadLinkProjectTool,
  ThreadUnlinkProjectTool,
  ThreadSearchTool,
);

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const expandHome = (path: Path.Path, value: string) => {
  if (value === "~") return NodeOS.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(NodeOS.homedir(), value.slice(2));
  }
  return value;
};

/** Resolves ids and folder paths to active projects, failing on anything unknown. */
const resolveProjectTargets = Effect.fn("WorkspaceMcpTools.resolveProjectTargets")(
  function* (input: {
    readonly projectIds?: ReadonlyArray<string> | undefined;
    readonly paths?: ReadonlyArray<string> | undefined;
  }) {
    const ids = (input.projectIds ?? []).map((id) => ProjectId.make(id));
    const paths = input.paths ?? [];
    if (ids.length === 0 && paths.length === 0) {
      return yield* invalid("Pass at least one project id or path.");
    }
    const store = yield* ProjectStore.ProjectStoreV2;
    const known = new Set(
      (ids.length === 0
        ? []
        : yield* store.list({ projectIds: ids }).pipe(Effect.mapError(unavailable))
      ).map((row) => row.projectId),
    );
    const unknownIds = ids.filter((id) => !known.has(id));
    if (unknownIds.length > 0) {
      return yield* invalid(
        `No active project has id ${unknownIds.map((id) => `'${id}'`).join(", ")}. Use t3_project_list to find ids.`,
      );
    }
    const path = yield* Path.Path;
    const projects = yield* ProjectService.ProjectService;
    const targets = [...ids];
    const unknownPaths: string[] = [];
    for (const raw of paths) {
      const expanded = expandHome(path, raw.trim());
      if (!path.isAbsolute(expanded)) {
        return yield* invalid(`Path must be absolute or start with ~: '${raw}'.`);
      }
      const project = yield* projects
        .getByWorkspaceRoot(path.resolve(expanded))
        .pipe(Effect.mapError(unavailable));
      if (Option.isNone(project)) unknownPaths.push(path.resolve(expanded));
      else targets.push(project.value.id);
    }
    if (unknownPaths.length > 0) {
      return yield* invalid(
        `No project is registered for ${unknownPaths.map((value) => `'${value}'`).join(", ")}. Register a folder with t3_project_create.`,
      );
    }
    return [...new Set(targets)];
  },
);

const changeThreadLinks = Effect.fn("WorkspaceMcpTools.changeThreadLinks")(function* (
  mode: "link" | "unlink",
  input: {
    readonly projectIds?: ReadonlyArray<string> | undefined;
    readonly paths?: ReadonlyArray<string> | undefined;
  },
) {
  const { threads, caller } = yield* readMutationCaller();
  if (caller === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_credential_required",
      message: `thread_${mode}_project changes the calling thread, so it needs an agent running inside a thread.`,
    });
  }
  // Linking widens what the agent may write, so it needs the same caller as project changes.
  if (
    mode === "link" &&
    (caller.runtimeMode !== "full-access" || caller.interactionMode !== "default")
  ) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Linking projects requires a live full-access/default calling thread.",
    });
  }
  const requested = yield* resolveProjectTargets(input);
  const notes: string[] = [];
  if (requested.includes(caller.projectId)) {
    notes.push(
      mode === "link"
        ? "This thread's own project is always included and was skipped."
        : "This thread's own project cannot be unlinked and was skipped.",
    );
  }
  const others = requested.filter((id) => id !== caller.projectId);
  const before = caller.linkedProjectIds ?? [];
  if (mode === "link") {
    const scratchRoot = yield* (yield* ManagedProjectFolders.ManagedProjectFolders).scratchRoot;
    if (Option.isSome(scratchRoot)) {
      const rows = yield* (yield* ProjectStore.ProjectStoreV2)
        .list({ projectIds: others })
        .pipe(Effect.mapError(unavailable));
      const scratchKey = normalizeProjectPathForComparison(scratchRoot.value);
      if (rows.some((row) => normalizeProjectPathForComparison(row.workspaceRoot) === scratchKey)) {
        return yield* invalid("The Scratch ('No project') project cannot be linked.");
      }
    }
  } else if (others.some((id) => !before.includes(id))) {
    notes.push("Projects that were not linked to this thread were left unchanged.");
  }
  if (others.length > 0) {
    yield* threads
      .dispatch({
        type: "thread.metadata.update",
        commandId: yield* newCommandId(),
        threadId: caller.id,
        ...(mode === "link" ? { linkProjectIds: others } : { unlinkProjectIds: others }),
      })
      .pipe(Effect.mapError(unavailable));
  }
  const updated: OrchestrationV2ThreadShell | null = yield* threads
    .getThreadShell(caller.id)
    .pipe(Effect.mapError(unavailable));
  const after = updated?.linkedProjectIds ?? before;
  if (mode === "unlink") {
    const project = yield* (yield* ProjectStore.ProjectStoreV2)
      .get(caller.projectId)
      .pipe(Effect.mapError(unavailable));
    const projectLinks: ReadonlyArray<ProjectId> = Option.match(project, {
      onNone: () => [],
      onSome: (row) => row.linkedProjectIds ?? [],
    });
    if (others.some((id) => projectLinks.includes(id))) {
      notes.push(
        "Some unlinked projects still apply through this thread's project's linked projects (see t3_project_update).",
      );
    }
  }
  notes.push("Folder access follows the links from this agent's next turn.");
  return {
    threadId: caller.id,
    projectId: caller.projectId,
    linkedProjectIds: after,
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
    note: notes.join(" "),
  };
});

const makeSnippet = (text: string, query: string) => {
  const index = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase()));
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 160);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
};

export const WorkspaceToolkitHandlersLive = WorkspaceToolkit.toLayer({
  thread_link_project: (input) => changeThreadLinks("link", input),
  thread_unlink_project: (input) => changeThreadLinks("unlink", input),
  t3_thread_search: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const query = input.query.trim();
      if (query.length === 0) return yield* invalid("Pass a non-blank query.");
      const limit = input.limit ?? THREAD_SEARCH_DEFAULT_LIMIT;
      const projectId = input.projectId === undefined ? undefined : ProjectId.make(input.projectId);
      if (projectId !== undefined) {
        const project = yield* (yield* ProjectStore.ProjectStoreV2)
          .get(projectId)
          .pipe(Effect.mapError(unavailable));
        if (Option.isNone(project)) {
          return yield* invalid(
            `No active project has id '${projectId}'. Use t3_project_list to find ids.`,
          );
        }
      }
      const rows = yield* Queries.searchThreads({
        query,
        projectId,
        includeArchived: input.includeArchived ?? true,
        excludeThreadId: input.includeCurrentThread === true ? undefined : caller?.id,
        limit,
      }).pipe(Effect.mapError(unavailable));
      const matches = yield* Effect.forEach(rows.slice(0, limit), (row) =>
        Queries.findFirstMatchingMessage(row.threadId, query).pipe(
          Effect.mapError(unavailable),
          Effect.map((message) => ({
            threadId: row.threadId,
            title: row.title,
            projectId: row.projectId,
            projectTitle: row.projectTitle,
            updatedAt: row.updatedAt,
            archived: row.archived,
            source: message === undefined ? ("title" as const) : message.role,
            snippet: makeSnippet(message?.text ?? row.title, query),
          })),
        ),
      );
      return { matches, hasMore: rows.length > limit };
    }),
});

/** Registers the workspace tools on the core MCP server every provider session receives. */
export const WorkspaceMcpToolsLive = McpServer.toolkit(WorkspaceToolkit).pipe(
  Layer.provide(WorkspaceToolkitHandlersLive),
);
