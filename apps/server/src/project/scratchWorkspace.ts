import type * as Path from "effect/Path";

/**
 * Folder behind the environment's "No project" (scratch) project. Every
 * scratch thread gets its own child folder here as its worktreePath. Whether
 * the folder is offered at all (data dir outside a Git checkout) is decided
 * per connection in ws.ts; this only names it.
 */
export const scratchWorkspaceRootFor = (path: Path.Path, baseDir: string): string =>
  path.resolve(baseDir, "scratch");
