import * as NodeOS from "node:os";

import { CommandId, type OrchestrationCommand, ProjectId, ThreadId } from "@upcomputer/contracts";
import { isPathWithinRoot, normalizeProjectPathForComparison } from "@upcomputer/shared/path";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ServerConfig } from "../../../config.ts";
import type { OrchestrationDispatchError } from "../../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { scratchWorkspaceRootFor } from "../../../project/scratchWorkspace.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Queries from "./queries.ts";
import {
  McpWorkspaceToolError,
  type McpWorkspaceToolErrorCode,
  THREAD_READ_DEFAULT_LIMIT,
  THREAD_READ_DEFAULT_MAX_CHARS,
  THREAD_SEARCH_DEFAULT_LIMIT,
  WorkspaceToolkit,
  type WorkspaceProjectSummary,
} from "./tools.ts";

const toolError = (code: McpWorkspaceToolErrorCode, message: string) =>
  new McpWorkspaceToolError({ code, message });

const NEXT_SESSION_NOTE =
  "Folder access for linked projects applies from this agent's next session start; the live session is not restarted.";

/** Persistence failures are logged server-side and reported without detail. */
const readProjection = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("workspace MCP tool read failed", { operation, cause }),
    ),
    Effect.mapError(() =>
      toolError("unavailable", "Up.computer could not read its project data. Try again."),
    ),
  );

const dispatchFailure = (error: OrchestrationDispatchError) =>
  error._tag === "OrchestrationCommandInvariantError"
    ? Effect.succeed(toolError("invalid_request", error.detail))
    : Effect.logWarning("workspace MCP tool dispatch failed", { errorTag: error._tag }).pipe(
        Effect.as(toolError("unavailable", "Up.computer could not apply the change. Try again.")),
      );

const dispatch = Effect.fn("WorkspaceToolkit.dispatch")(function* (command: OrchestrationCommand) {
  const engine = yield* OrchestrationEngineService;
  return yield* engine
    .dispatch(command)
    .pipe(Effect.catch((error) => Effect.flip(dispatchFailure(error))));
});

const serverCommandId = Effect.fn("WorkspaceToolkit.serverCommandId")(function* (tag: string) {
  const crypto = yield* Crypto.Crypto;
  const uuid = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  return CommandId.make(`server:mcp-${tag}:${uuid}`);
});

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const requireWorkspaceCapability = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("workspace")) {
    return yield* toolError(
      "capability_denied",
      "This agent session is not allowed to use the Up.computer project and thread tools.",
    );
  }
  return invocation;
});

interface WorkspaceState {
  readonly invocationThreadId: ThreadId;
  readonly scratchRoot: string;
  readonly projects: ReadonlyArray<Queries.WorkspaceProjectRow>;
  readonly projectsById: ReadonlyMap<ProjectId, Queries.WorkspaceProjectRow>;
  readonly thread: Queries.WorkspaceThreadRow | undefined;
}

const loadWorkspaceState = Effect.fn("WorkspaceToolkit.loadWorkspaceState")(function* () {
  const invocation = yield* requireWorkspaceCapability;
  const config = yield* ServerConfig;
  const path = yield* Path.Path;
  const projects = yield* readProjection("listActiveProjects", Queries.listActiveProjects());
  const thread = yield* readProjection(
    "getActiveThread",
    Queries.getActiveThread(invocation.threadId),
  );
  return {
    invocationThreadId: invocation.threadId,
    scratchRoot: scratchWorkspaceRootFor(path, config.baseDir),
    projects,
    projectsById: new Map(projects.map((project) => [project.projectId, project])),
    thread,
  } satisfies WorkspaceState;
});

const requireCallingThread = (state: WorkspaceState) =>
  state.thread === undefined
    ? Effect.fail(
        toolError(
          "no_calling_thread",
          "This tool acts on the calling thread, but no active thread is bound to this agent session.",
        ),
      )
    : Effect.succeed(state.thread);

const activeLinks = (state: WorkspaceState, ids: ReadonlyArray<ProjectId>) =>
  ids.filter((id) => state.projectsById.has(id));

const isNoProject = (state: WorkspaceState, project: Queries.WorkspaceProjectRow) =>
  normalizeProjectPathForComparison(project.workspaceRoot) ===
  normalizeProjectPathForComparison(state.scratchRoot);

const toSummary = (
  state: WorkspaceState,
  project: Queries.WorkspaceProjectRow,
): WorkspaceProjectSummary => ({
  projectId: project.projectId,
  title: project.title,
  workspaceRoot: project.workspaceRoot,
  linkedProjectIds: activeLinks(state, project.linkedProjectIds),
  isNoProject: isNoProject(state, project),
});

const expandHome = (path: Path.Path, value: string) => {
  if (value === "~") return NodeOS.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(NodeOS.homedir(), value.slice(2));
  }
  return value;
};

/** Absolute or ~-prefixed paths only; relative paths have no meaningful base here. */
const resolveAbsolutePath = Effect.fn("WorkspaceToolkit.resolveAbsolutePath")(function* (
  raw: string,
) {
  const path = yield* Path.Path;
  const expanded = expandHome(path, raw.trim());
  if (!path.isAbsolute(expanded)) {
    return yield* toolError("invalid_request", `Path must be absolute or start with ~: '${raw}'.`);
  }
  return path.resolve(expanded);
});

const findProjectByPath = (state: WorkspaceState, absolutePath: string) => {
  const target = normalizeProjectPathForComparison(absolutePath);
  return state.projects.find(
    (project) => normalizeProjectPathForComparison(project.workspaceRoot) === target,
  );
};

interface ThreadLinkInput {
  readonly projectIds?: ReadonlyArray<string> | undefined;
  readonly paths?: ReadonlyArray<string> | undefined;
}

/** Resolves ids and folder paths to active projects, failing on anything unknown. */
const resolveProjectTargets = Effect.fn("WorkspaceToolkit.resolveProjectTargets")(function* (
  state: WorkspaceState,
  input: ThreadLinkInput,
) {
  const projectIds = (input.projectIds ?? []).map((id) => ProjectId.make(id));
  const paths = input.paths ?? [];
  if (projectIds.length === 0 && paths.length === 0) {
    return yield* toolError("invalid_request", "Pass at least one project id or path.");
  }
  const unknownIds = projectIds.filter((id) => !state.projectsById.has(id));
  if (unknownIds.length > 0) {
    return yield* toolError(
      "not_found",
      `No active project has id ${unknownIds.map((id) => `'${id}'`).join(", ")}. Use project_list to find ids.`,
    );
  }
  const targets: ProjectId[] = [...projectIds];
  const unknownPaths: string[] = [];
  for (const raw of paths) {
    const absolutePath = yield* resolveAbsolutePath(raw);
    const project = findProjectByPath(state, absolutePath);
    if (project === undefined) unknownPaths.push(absolutePath);
    else targets.push(project.projectId);
  }
  if (unknownPaths.length > 0) {
    return yield* toolError(
      "not_found",
      `No project is registered for ${unknownPaths.map((value) => `'${value}'`).join(", ")}. Register a folder with project_create.`,
    );
  }
  return [...new Set(targets)];
});

const rejectNoProjectTargets = (state: WorkspaceState, ids: ReadonlyArray<ProjectId>) => {
  const scratch = ids.find((id) => {
    const project = state.projectsById.get(id);
    return project !== undefined && isNoProject(state, project);
  });
  return scratch === undefined
    ? Effect.void
    : Effect.fail(toolError("invalid_request", "The 'No project' scratch home cannot be linked."));
};

const makeSnippet = (text: string, query: string) => {
  const radiusBefore = 80;
  const radiusAfter = 160;
  const index = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase()));
  const start = Math.max(0, index - radiusBefore);
  const end = Math.min(text.length, index + query.length + radiusAfter);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
};

const isNonEmpty = <A>(values: ReadonlyArray<A>): values is readonly [A, ...Array<A>] =>
  values.length > 0;

const truncate = (text: string, maxChars: number) =>
  text.length > maxChars
    ? { text: `${text.slice(0, maxChars)}…`, truncated: true }
    : { text, truncated: false };

const changeThreadLinks = Effect.fn("WorkspaceToolkit.changeThreadLinks")(function* (
  mode: "link" | "unlink",
  input: ThreadLinkInput,
) {
  const state = yield* loadWorkspaceState();
  const thread = yield* requireCallingThread(state);
  const requested = yield* resolveProjectTargets(state, input);
  const before = activeLinks(state, thread.linkedProjectIds);
  const notes: string[] = [];
  if (requested.includes(thread.projectId)) {
    notes.push(
      mode === "link"
        ? "This thread's own project is always included and was skipped."
        : "This thread's own project cannot be unlinked and was skipped.",
    );
  }
  const others = requested.filter((id) => id !== thread.projectId);
  let changes: ReadonlyArray<ProjectId>;
  if (mode === "link") {
    yield* rejectNoProjectTargets(state, others);
    changes = others.filter((id) => !before.includes(id));
  } else {
    changes = others.filter((id) => before.includes(id));
    if (changes.length < others.length) {
      notes.push("Projects that were not linked to this thread were left unchanged.");
    }
  }

  if (isNonEmpty(changes)) {
    yield* dispatch({
      type: mode === "link" ? "thread.project.link" : "thread.project.unlink",
      commandId: yield* serverCommandId(`thread-project-${mode}`),
      threadId: thread.threadId,
      projectIds: changes,
    });
  }

  const updated = yield* readProjection(
    "getActiveThread",
    Queries.getActiveThread(thread.threadId),
  );
  const after = activeLinks(state, updated?.linkedProjectIds ?? before);
  if (mode === "unlink") {
    const threadProject = state.projectsById.get(thread.projectId);
    const tags = threadProject?.linkedProjectIds ?? [];
    if (changes.some((id) => tags.includes(id))) {
      notes.push(
        "Some unlinked projects still apply through this thread's project tags (see project_set_linked_projects).",
      );
    }
  }
  notes.push(NEXT_SESSION_NOTE);
  return {
    threadId: thread.threadId,
    projectId: thread.projectId,
    linkedProjectIds: after,
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
    note: notes.join(" "),
  };
});

export const WorkspaceToolkitHandlersLive = WorkspaceToolkit.toLayer({
  project_list: Effect.fn("WorkspaceToolkit.project_list")(function* () {
    const state = yield* loadWorkspaceState();
    const thread = state.thread;
    const threadLinks = thread === undefined ? [] : activeLinks(state, thread.linkedProjectIds);
    const threadProjectTags =
      thread === undefined
        ? []
        : activeLinks(state, state.projectsById.get(thread.projectId)?.linkedProjectIds ?? []);
    return {
      currentThread:
        thread === undefined
          ? null
          : {
              threadId: thread.threadId,
              projectId: thread.projectId,
              linkedProjectIds: threadLinks,
            },
      projects: state.projects.map((project) => ({
        ...toSummary(state, project),
        isCurrentThreadProject: project.projectId === thread?.projectId,
        isLinkedToCurrentThread: threadLinks.includes(project.projectId),
        isTagOfCurrentThreadProject: threadProjectTags.includes(project.projectId),
      })),
    };
  }),

  project_create: Effect.fn("WorkspaceToolkit.project_create")(function* (input) {
    const state = yield* loadWorkspaceState();
    const linkRequested = input.linkToThisThread ?? true;
    const thread = linkRequested ? yield* requireCallingThread(state) : state.thread;
    const path = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;
    const workspaceRoot = yield* resolveAbsolutePath(input.path);
    if (isPathWithinRoot(workspaceRoot, state.scratchRoot)) {
      return yield* toolError(
        "invalid_request",
        "Folders inside the 'No project' scratch area cannot become projects. Choose a folder outside it.",
      );
    }

    const notes: string[] = [];
    let project = findProjectByPath(state, workspaceRoot);
    let created = false;
    let folderCreated = false;
    if (project !== undefined) {
      notes.push("A project already existed for this folder and was reused.");
    } else {
      const existing = yield* fileSystem.stat(workspaceRoot).pipe(
        Effect.map((info) => info.type),
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed(null),
        ),
        Effect.mapError(() =>
          toolError("invalid_request", `Could not inspect folder '${workspaceRoot}'.`),
        ),
      );
      if (existing === null) {
        if (input.createFolder === false) {
          return yield* toolError(
            "invalid_request",
            `Folder '${workspaceRoot}' does not exist. Pass createFolder: true to create it.`,
          );
        }
        yield* fileSystem
          .makeDirectory(workspaceRoot, { recursive: true })
          .pipe(
            Effect.mapError(() =>
              toolError("invalid_request", `Could not create folder '${workspaceRoot}'.`),
            ),
          );
        folderCreated = true;
      } else if (existing !== "Directory") {
        return yield* toolError("invalid_request", `'${workspaceRoot}' is not a folder.`);
      }

      const projectId = ProjectId.make(
        yield* (yield* Crypto.Crypto).randomUUIDv4.pipe(Effect.orDie),
      );
      const title = input.title?.trim() || path.basename(workspaceRoot) || workspaceRoot;
      const dispatched = yield* dispatch({
        type: "project.create",
        commandId: yield* serverCommandId("project-create"),
        projectId,
        title,
        workspaceRoot,
        createWorkspaceRootIfMissing: false,
        createdAt: yield* nowIso,
      }).pipe(Effect.result);
      const refreshed = yield* loadWorkspaceState();
      if (dispatched._tag === "Success") {
        project = refreshed.projectsById.get(projectId);
        created = project !== undefined;
      } else {
        // Another client may have registered the same folder meanwhile.
        project = findProjectByPath(refreshed, workspaceRoot);
        if (project === undefined) return yield* dispatched.failure;
        notes.push("A project for this folder was registered concurrently and was reused.");
      }
      if (project === undefined) {
        return yield* toolError(
          "unavailable",
          "The project was created but could not be read back.",
        );
      }
    }

    let linkedToThisThread = false;
    if (linkRequested && thread !== undefined) {
      if (project.projectId === thread.projectId) {
        notes.push("It is already this thread's own project, so no link was added.");
      } else {
        if (!thread.linkedProjectIds.includes(project.projectId)) {
          yield* dispatch({
            type: "thread.project.link",
            commandId: yield* serverCommandId("thread-project-link"),
            threadId: thread.threadId,
            projectIds: [project.projectId],
          });
        }
        linkedToThisThread = true;
        notes.push(`Linked to this thread. ${NEXT_SESSION_NOTE}`);
      }
    }

    const finalState = yield* loadWorkspaceState();
    return {
      project: toSummary(finalState, finalState.projectsById.get(project.projectId) ?? project),
      created,
      folderCreated,
      linkedToThisThread,
      note: notes.join(" ") || "Project registered.",
    };
  }),

  thread_link_project: (input) => changeThreadLinks("link", input),

  thread_unlink_project: (input) => changeThreadLinks("unlink", input),

  project_set_linked_projects: Effect.fn("WorkspaceToolkit.project_set_linked_projects")(
    function* (input) {
      const state = yield* loadWorkspaceState();
      const projectId = ProjectId.make(input.projectId);
      if (!state.projectsById.has(projectId)) {
        return yield* toolError(
          "not_found",
          `No active project has id '${projectId}'. Use project_list to find ids.`,
        );
      }
      const targets = [...new Set(input.linkedProjectIds.map((id) => ProjectId.make(id)))].filter(
        (id) => id !== projectId,
      );
      const unknownIds = targets.filter((id) => !state.projectsById.has(id));
      if (unknownIds.length > 0) {
        return yield* toolError(
          "not_found",
          `No active project has id ${unknownIds.map((id) => `'${id}'`).join(", ")}. Use project_list to find ids.`,
        );
      }
      yield* rejectNoProjectTargets(state, targets);
      yield* dispatch({
        type: "project.meta.update",
        commandId: yield* serverCommandId("project-set-linked-projects"),
        projectId,
        linkedProjectIds: targets,
      });
      const refreshed = yield* loadWorkspaceState();
      const project = refreshed.projectsById.get(projectId);
      return {
        projectId,
        linkedProjectIds: project ? activeLinks(refreshed, project.linkedProjectIds) : targets,
      };
    },
  ),

  thread_search: Effect.fn("WorkspaceToolkit.thread_search")(function* (input) {
    const invocation = yield* requireWorkspaceCapability;
    const query = input.query.trim();
    if (query.length === 0) {
      return yield* toolError("invalid_request", "Pass a non-blank query.");
    }
    const limit = input.limit ?? THREAD_SEARCH_DEFAULT_LIMIT;
    const projectId = input.projectId === undefined ? undefined : ProjectId.make(input.projectId);
    if (projectId !== undefined) {
      const projects = yield* readProjection("listActiveProjects", Queries.listActiveProjects());
      if (!projects.some((project) => project.projectId === projectId)) {
        return yield* toolError(
          "not_found",
          `No active project has id '${projectId}'. Use project_list to find ids.`,
        );
      }
    }
    const rows = yield* readProjection(
      "searchThreads",
      Queries.searchThreads({
        query,
        projectId,
        excludeThreadId: input.includeCurrentThread === true ? undefined : invocation.threadId,
        limit,
      }),
    );
    const results = yield* Effect.forEach(rows.slice(0, limit), (row) =>
      readProjection(
        "findFirstMatchingMessage",
        Queries.findFirstMatchingMessage(row.threadId, query),
      ).pipe(
        Effect.map((messageText) => ({
          threadId: row.threadId,
          title: row.title,
          projectId: row.projectId,
          projectTitle: row.projectTitle,
          updatedAt: row.updatedAt,
          archived: row.archivedAt !== null,
          matchedIn: messageText === undefined ? ("title" as const) : ("message" as const),
          snippet: makeSnippet(messageText ?? row.title, query),
        })),
      ),
    );
    return { results, hasMore: rows.length > limit };
  }),

  thread_read: Effect.fn("WorkspaceToolkit.thread_read")(function* (input) {
    yield* requireWorkspaceCapability;
    const threadId = ThreadId.make(input.threadId);
    const thread = yield* readProjection("getActiveThread", Queries.getActiveThread(threadId));
    if (thread === undefined) {
      return yield* toolError(
        "not_found",
        `No thread has id '${threadId}'. Find thread ids with thread_search.`,
      );
    }
    const projects = yield* readProjection("listActiveProjects", Queries.listActiveProjects());
    const projectsById = new Map(projects.map((project) => [project.projectId, project]));
    const project = projectsById.get(thread.projectId);
    const maxChars = input.maxChars ?? THREAD_READ_DEFAULT_MAX_CHARS;
    const messages = yield* readProjection(
      "listLatestThreadMessages",
      Queries.listLatestThreadMessages(thread.threadId, input.limit ?? THREAD_READ_DEFAULT_LIMIT),
    );
    const totalMessageCount = yield* readProjection(
      "countThreadMessages",
      Queries.countThreadMessages(thread.threadId),
    );
    return {
      threadId: thread.threadId,
      title: thread.title,
      projectId: thread.projectId,
      projectTitle: project?.title ?? null,
      projectWorkspaceRoot: project?.workspaceRoot ?? null,
      worktreePath: thread.worktreePath,
      linkedProjectIds: thread.linkedProjectIds.filter((id) => projectsById.has(id)),
      archived: thread.archivedAt !== null,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      totalMessageCount,
      messages: messages.map((message) => ({
        role: message.role,
        createdAt: message.createdAt,
        ...truncate(message.text, maxChars),
      })),
    };
  }),
});
