import type { ProjectId, ProviderRuntimeEvent } from "@upcomputer/contracts";
import { isPathWithinRoot, normalizeProjectPathForComparison } from "@upcomputer/shared/path";

/**
 * Auto-linking threads to the projects their agent writes into.
 *
 * When a completed file-change tool call wrote inside another registered
 * project's folder, ingestion links the thread to that project. Only writes
 * count (reads never do), and writes inside the thread's own tree never do.
 */

// Claude's classifier also files tools such as `mcp__fs__read_file` under
// `file_change`, so only its known writing tools are trusted.
const CLAUDE_WRITE_TOOL_PATH_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  Write: ["file_path"],
  NotebookEdit: ["notebook_path"],
};

const ACP_WRITE_TOOL_KINDS = new Set(["edit", "delete", "move"]);
const GENERIC_PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"] as const;
const PATCH_FILE_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gmu;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pushPath(paths: string[], value: unknown): void {
  const path = asPath(value);
  if (path !== undefined && !paths.includes(path)) {
    paths.push(path);
  }
}

function pushPathKeys(paths: string[], record: Record<string, unknown> | undefined): void {
  for (const key of GENERIC_PATH_KEYS) {
    pushPath(paths, record?.[key]);
  }
}

// `apply_patch`-style envelopes name every touched file in a header line.
function pushPatchPaths(paths: string[], patchText: unknown): void {
  if (typeof patchText !== "string") {
    return;
  }
  for (const match of patchText.matchAll(PATCH_FILE_HEADER)) {
    pushPath(paths, match[1]);
  }
}

/**
 * Paths a completed, successful file-change tool call wrote, as the provider
 * reported them (absolute or relative to the session cwd). Recognized shapes:
 * - Claude: `{ toolName: Edit | MultiEdit | Write | NotebookEdit, input }`.
 * - Codex: `{ item: { type: "fileChange", changes: [{ path, kind }] } }`.
 * - OpenCode: `{ tool, input: { filePath } | { patchText } }`.
 * - ACP (Grok, Cursor): `{ kind: edit | delete | move, locations, content, rawInput }`.
 */
export function extractWrittenPaths(event: ProviderRuntimeEvent): ReadonlyArray<string> {
  if (event.type !== "item.completed" || event.payload.itemType !== "file_change") {
    return [];
  }
  const status = event.payload.status;
  if (status !== undefined && status !== "completed") {
    return [];
  }
  const data = asRecord(event.payload.data);
  if (!data) {
    return [];
  }
  const paths: string[] = [];

  const codexItem = asRecord(data.item);
  if (codexItem?.type === "fileChange") {
    if (Array.isArray(codexItem.changes)) {
      for (const change of codexItem.changes) {
        const record = asRecord(change);
        pushPath(paths, record?.path);
        pushPath(paths, asRecord(record?.kind)?.move_path);
      }
    }
    return paths;
  }

  if (typeof data.toolName === "string") {
    const keys = CLAUDE_WRITE_TOOL_PATH_KEYS[data.toolName];
    const input = asRecord(data.input);
    for (const key of keys ?? []) {
      pushPath(paths, input?.[key]);
    }
    return paths;
  }

  if (typeof data.tool === "string") {
    const input = asRecord(data.input) ?? asRecord(asRecord(data.state)?.input);
    pushPathKeys(paths, input);
    pushPatchPaths(paths, input?.patchText);
    return paths;
  }

  if (typeof data.kind === "string" && ACP_WRITE_TOOL_KINDS.has(data.kind)) {
    if (Array.isArray(data.locations)) {
      for (const location of data.locations) {
        pushPath(paths, asRecord(location)?.path);
      }
    }
    if (Array.isArray(data.content)) {
      for (const entry of data.content) {
        const record = asRecord(entry);
        if (record?.type === "diff") {
          pushPath(paths, record.path);
        }
      }
    }
    pushPathKeys(paths, asRecord(data.rawInput));
  }
  return paths;
}

export interface AutoLinkProject {
  readonly id: ProjectId;
  readonly workspaceRoot: string;
  readonly deletedAt?: string | null | undefined;
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

export interface AutoLinkThread {
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
  readonly linkedProjectIds?: ReadonlyArray<ProjectId> | undefined;
}

/** The subset of `effect/Path` (or `node:path`) used to resolve written paths. */
export interface AutoLinkPathApi {
  readonly isAbsolute: (path: string) => boolean;
  readonly resolve: (...segments: ReadonlyArray<string>) => string;
}

interface AutoLinkContext {
  readonly cwd: string | undefined;
  readonly activeProjects: ReadonlyArray<AutoLinkProject>;
  readonly ownTreeRoots: ReadonlyArray<string>;
  readonly excludedProjectIds: ReadonlySet<ProjectId>;
  readonly scratchRootKey: string | undefined;
}

function makeAutoLinkContext(input: {
  readonly thread: AutoLinkThread;
  readonly projects: ReadonlyArray<AutoLinkProject>;
  readonly scratchRoot: string | undefined;
}): AutoLinkContext {
  const activeProjects = input.projects.filter((project) => (project.deletedAt ?? null) === null);
  const ownProject = activeProjects.find((project) => project.id === input.thread.projectId);
  const cwd = input.thread.worktreePath ?? ownProject?.workspaceRoot;
  // The home project's folder counts as the thread's own tree even when the
  // thread runs in a worktree elsewhere; so do projects nested inside either.
  const ownTreeRoots = [cwd, ownProject?.workspaceRoot].filter(
    (root): root is string => root !== undefined,
  );
  // Already reachable: the thread's own links and its project's tags.
  const excludedProjectIds = new Set<ProjectId>([
    input.thread.projectId,
    ...(input.thread.linkedProjectIds ?? []),
    ...(ownProject?.linkedProjectIds ?? []),
  ]);
  return {
    cwd,
    activeProjects,
    ownTreeRoots,
    excludedProjectIds,
    scratchRootKey:
      input.scratchRoot === undefined
        ? undefined
        : normalizeProjectPathForComparison(input.scratchRoot),
  };
}

function matchWithContext(path: string, context: AutoLinkContext): ProjectId | undefined {
  if (context.ownTreeRoots.some((root) => isPathWithinRoot(path, root))) {
    return undefined;
  }
  // The deepest registered folder owns the file, even when that project is
  // excluded below: a write inside an already-linked nested project must not
  // fall through to the project around it.
  let owner: { readonly project: AutoLinkProject; readonly rootKey: string } | undefined;
  for (const project of context.activeProjects) {
    const rootKey = normalizeProjectPathForComparison(project.workspaceRoot);
    if (
      (owner === undefined || rootKey.length > owner.rootKey.length) &&
      isPathWithinRoot(path, project.workspaceRoot)
    ) {
      owner = { project, rootKey };
    }
  }
  if (
    owner === undefined ||
    context.excludedProjectIds.has(owner.project.id) ||
    owner.rootKey === context.scratchRootKey
  ) {
    return undefined;
  }
  return owner.project.id;
}

/**
 * The project an absolute written path should link the thread to, if any: the
 * active project with the longest workspace root containing the path, unless
 * that is the thread's own project, one it already reaches, or the scratch
 * ("No project") project, or the path lies inside the thread's own tree.
 */
export function matchProjectForPath(input: {
  readonly path: string;
  readonly thread: AutoLinkThread;
  readonly projects: ReadonlyArray<AutoLinkProject>;
  readonly scratchRoot: string | undefined;
}): ProjectId | undefined {
  return matchWithContext(input.path, makeAutoLinkContext(input));
}

/**
 * Projects to link for a set of written paths. Relative paths resolve against
 * the thread's cwd (its worktree, else its project's root) and are dropped
 * when there is no cwd to resolve them against.
 */
export function resolveAutoLinkProjectIds(input: {
  readonly writtenPaths: ReadonlyArray<string>;
  readonly thread: AutoLinkThread;
  readonly projects: ReadonlyArray<AutoLinkProject>;
  readonly scratchRoot: string | undefined;
  readonly path: AutoLinkPathApi;
}): ReadonlyArray<ProjectId> {
  const context = makeAutoLinkContext(input);
  const projectIds: ProjectId[] = [];
  for (const writtenPath of input.writtenPaths) {
    const absolutePath = input.path.isAbsolute(writtenPath)
      ? input.path.resolve(writtenPath)
      : context.cwd !== undefined
        ? input.path.resolve(context.cwd, writtenPath)
        : undefined;
    if (absolutePath === undefined) {
      continue;
    }
    const projectId = matchWithContext(absolutePath, context);
    if (projectId !== undefined && !projectIds.includes(projectId)) {
      projectIds.push(projectId);
    }
  }
  return projectIds;
}
