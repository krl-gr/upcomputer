import { mediaFileReference } from "@t3tools/client-runtime/media-reference";

/**
 * The path a worker thread's right panel opens. Inside the thread's workspace it is relative, as
 * chat's own links are, so the file opens editable and takes comments; a host path opens read-only.
 */
export function workerThreadFilePath(
  absolutePath: string,
  threadWorkspaceRoot: string | null | undefined,
): string {
  return mediaFileReference(absolutePath, threadWorkspaceRoot).relativePath ?? absolutePath;
}
