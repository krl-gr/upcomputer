import { ProjectId, ThreadId } from "@upcomputer/contracts";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../../config.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/**
 * Agent-facing tools for projects and threads. Every tool acts for the thread
 * whose MCP credential made the call ("this thread").
 */

export const McpWorkspaceToolErrorCode = Schema.Literals([
  "invalid_request",
  "not_found",
  "no_calling_thread",
  "capability_denied",
  "unavailable",
]);
export type McpWorkspaceToolErrorCode = typeof McpWorkspaceToolErrorCode.Type;

export class McpWorkspaceToolError extends Schema.TaggedErrorClass<McpWorkspaceToolError>()(
  "McpWorkspaceToolError",
  {
    code: McpWorkspaceToolErrorCode,
    message: Schema.String,
  },
) {}

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngineService,
  SqlClient.SqlClient,
  ServerConfig,
  FileSystem.FileSystem,
  Path.Path,
  Crypto.Crypto,
];

const shared = {
  failure: McpWorkspaceToolError,
  dependencies,
};

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

const mutatingTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.OpenWorld, false) as T;

// Input fields use plain checked strings rather than the branded, trimming
// contract schemas: transformations drop descriptions from the exported JSON
// schema. Handlers brand ids and trim text themselves.
const described = <S extends Schema.Top>(schema: S, description: string) =>
  schema.annotate({ description }) as S;

const optionalDescribed = <S extends Schema.Top>(schema: S, description: string) =>
  Schema.optional(described(schema, description)).annotate({ description });

const NonEmptyText = Schema.String.check(Schema.isNonEmpty());
const IdInput = Schema.String.check(Schema.isTrimmed()).check(Schema.isNonEmpty());
const IdInputList = Schema.Array(IdInput);

const ProjectIdList = Schema.Array(ProjectId);

export const WorkspaceProjectSummary = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  workspaceRoot: Schema.String,
  linkedProjectIds: ProjectIdList,
  isNoProject: Schema.Boolean,
});
export type WorkspaceProjectSummary = typeof WorkspaceProjectSummary.Type;

export const WorkspaceProjectListEntry = Schema.Struct({
  ...WorkspaceProjectSummary.fields,
  isCurrentThreadProject: Schema.Boolean,
  isLinkedToCurrentThread: Schema.Boolean,
  isTagOfCurrentThreadProject: Schema.Boolean,
});

const CurrentThreadSummary = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  linkedProjectIds: ProjectIdList,
});

const ThreadLinksResult = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  linkedProjectIds: ProjectIdList,
  added: ProjectIdList,
  removed: ProjectIdList,
  note: Schema.String,
});

export const ProjectListTool = readonlyTool(
  Tool.make("project_list", {
    ...shared,
    description:
      "List all active Up.computer projects: id, title, workspaceRoot folder, linkedProjectIds (project tags), and isNoProject for the hidden 'No project' scratch home. Also reports this thread's own project and which projects are linked to it directly or through its project's tags.",
    success: Schema.Struct({
      currentThread: Schema.NullOr(CurrentThreadSummary),
      projects: Schema.Array(WorkspaceProjectListEntry),
    }),
  }).annotate(Tool.Title, "List projects"),
);

export const ProjectCreateTool = mutatingTool(
  Tool.make("project_create", {
    ...shared,
    description:
      "Register a folder as an Up.computer project. If a project already exists for that folder it is reused instead of failing. By default the folder is created when missing and the project is linked to this thread, so it shows under that project and its folder becomes available to this agent from its next session start.",
    parameters: Schema.Struct({
      path: described(
        NonEmptyText,
        "Absolute folder path, or a path starting with ~ for the home directory. Relative paths and folders inside the 'No project' scratch area are rejected.",
      ),
      title: optionalDescribed(
        NonEmptyText,
        "Project title shown in the sidebar. Defaults to the folder name. Ignored when an existing project is reused.",
      ),
      createFolder: optionalDescribed(
        Schema.Boolean,
        "Create the folder (and missing parents) when it does not exist. Defaults to true; with false a missing folder is an error.",
      ),
      linkToThisThread: optionalDescribed(
        Schema.Boolean,
        "Link the project to this thread after creating or reusing it. Defaults to true. Skipped when it is already this thread's own project.",
      ),
    }),
    success: Schema.Struct({
      project: WorkspaceProjectSummary,
      created: Schema.Boolean,
      folderCreated: Schema.Boolean,
      linkedToThisThread: Schema.Boolean,
      note: Schema.String,
    }),
  }).annotate(Tool.Title, "Create project"),
);

const threadLinkParameters = Schema.Struct({
  projectIds: optionalDescribed(IdInputList, "Project ids from project_list. Combined with paths."),
  paths: optionalDescribed(
    Schema.Array(NonEmptyText),
    "Project folders (absolute or ~) resolved to registered projects by workspaceRoot. Combined with projectIds; unknown folders are an error.",
  ),
});

export const ThreadLinkProjectTool = mutatingTool(
  Tool.make("thread_link_project", {
    ...shared,
    description:
      "Link projects to this thread so it also shows under them in the sidebar and their folders become available to this agent. Pass projectIds and/or paths. Folder access applies from the agent's next session start; the live session is not restarted.",
    parameters: threadLinkParameters,
    success: ThreadLinksResult,
  })
    .annotate(Tool.Title, "Link projects to this thread")
    .annotate(Tool.Idempotent, true),
);

export const ThreadUnlinkProjectTool = mutatingTool(
  Tool.make("thread_unlink_project", {
    ...shared,
    description:
      "Unlink projects from this thread. Pass projectIds and/or paths. This thread's own project cannot be unlinked, and links coming from project tags are not changed (use project_set_linked_projects).",
    parameters: threadLinkParameters,
    success: ThreadLinksResult,
  })
    .annotate(Tool.Title, "Unlink projects from this thread")
    .annotate(Tool.Idempotent, true),
);

export const ProjectSetLinkedProjectsTool = mutatingTool(
  Tool.make("project_set_linked_projects", {
    ...shared,
    description:
      "Replace a project's linked projects (its tags). Every thread of the project also shows under, and its agent can access, the linked projects. Pass the full desired list; an empty list clears the tags.",
    parameters: Schema.Struct({
      projectId: described(IdInput, "Project whose tags are replaced, from project_list."),
      linkedProjectIds: described(
        IdInputList,
        "Complete new list of linked project ids. The project itself and duplicates are dropped.",
      ),
    }),
    success: Schema.Struct({
      projectId: ProjectId,
      linkedProjectIds: ProjectIdList,
    }),
  })
    .annotate(Tool.Title, "Set project tags")
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true),
);

export const THREAD_SEARCH_DEFAULT_LIMIT = 20;
export const THREAD_SEARCH_MAX_LIMIT = 50;

export const ThreadSearchTool = readonlyTool(
  Tool.make("thread_search", {
    ...shared,
    description:
      "Search Up.computer threads (including archived, excluding deleted) by case-insensitive text in their titles and user/assistant messages. Optionally restrict to threads that belong to a project directly, by thread link, or through project tags. Returns newest threads first with a snippet around the first match; read one with thread_read.",
    parameters: Schema.Struct({
      query: described(
        NonEmptyText.check(Schema.isMaxLength(500)),
        "Text to look for (substring, case-insensitive).",
      ),
      projectId: optionalDescribed(IdInput, "Only search threads that belong to this project."),
      limit: optionalDescribed(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: THREAD_SEARCH_MAX_LIMIT })),
        `Maximum threads to return, 1-${THREAD_SEARCH_MAX_LIMIT}. Defaults to ${THREAD_SEARCH_DEFAULT_LIMIT}.`,
      ),
      includeCurrentThread: optionalDescribed(
        Schema.Boolean,
        "Include this thread in the results. Defaults to false.",
      ),
    }),
    success: Schema.Struct({
      results: Schema.Array(
        Schema.Struct({
          threadId: ThreadId,
          title: Schema.String,
          projectId: ProjectId,
          projectTitle: Schema.NullOr(Schema.String),
          updatedAt: Schema.String,
          archived: Schema.Boolean,
          matchedIn: Schema.Literals(["title", "message"]),
          snippet: Schema.String,
        }),
      ),
      hasMore: Schema.Boolean,
    }),
  }).annotate(Tool.Title, "Search threads"),
);

export const THREAD_READ_DEFAULT_LIMIT = 50;
export const THREAD_READ_MAX_LIMIT = 200;
export const THREAD_READ_DEFAULT_MAX_CHARS = 4_000;
export const THREAD_READ_MAX_CHARS = 50_000;

export const ThreadReadTool = readonlyTool(
  Tool.make("thread_read", {
    ...shared,
    description:
      "Read an Up.computer thread: title, project, linked projects, and its last user/assistant messages in chronological order. Long messages are truncated to maxChars. Find thread ids with thread_search.",
    parameters: Schema.Struct({
      threadId: described(IdInput, "Thread to read, for example from thread_search."),
      limit: optionalDescribed(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: THREAD_READ_MAX_LIMIT })),
        `How many of the latest user/assistant messages to return, 1-${THREAD_READ_MAX_LIMIT}. Defaults to ${THREAD_READ_DEFAULT_LIMIT}.`,
      ),
      maxChars: optionalDescribed(
        Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: THREAD_READ_MAX_CHARS })),
        `Maximum characters kept per message, 100-${THREAD_READ_MAX_CHARS}. Defaults to ${THREAD_READ_DEFAULT_MAX_CHARS}.`,
      ),
    }),
    success: Schema.Struct({
      threadId: ThreadId,
      title: Schema.String,
      projectId: ProjectId,
      projectTitle: Schema.NullOr(Schema.String),
      projectWorkspaceRoot: Schema.NullOr(Schema.String),
      worktreePath: Schema.NullOr(Schema.String),
      linkedProjectIds: ProjectIdList,
      archived: Schema.Boolean,
      createdAt: Schema.String,
      updatedAt: Schema.String,
      totalMessageCount: Schema.Number,
      messages: Schema.Array(
        Schema.Struct({
          role: Schema.Literals(["user", "assistant"]),
          createdAt: Schema.String,
          text: Schema.String,
          truncated: Schema.Boolean,
        }),
      ),
    }),
  }).annotate(Tool.Title, "Read thread"),
);

export const WorkspaceToolkit = Toolkit.make(
  ProjectListTool,
  ProjectCreateTool,
  ThreadLinkProjectTool,
  ThreadUnlinkProjectTool,
  ProjectSetLinkedProjectsTool,
  ThreadSearchTool,
  ThreadReadTool,
);
