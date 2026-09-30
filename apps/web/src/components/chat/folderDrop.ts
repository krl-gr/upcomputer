import type { EnvironmentId } from "@upcomputer/contracts";

interface DroppedItem {
  readonly kind: string;
  getAsFile(): File | null;
  webkitGetAsEntry(): { readonly isDirectory: boolean } | null;
}

/**
 * A dropped folder can only become a path the agent can read when the thread
 * runs on this machine's (primary) environment; a remote machine cannot see
 * local paths.
 */
export function folderDropTarget(input: {
  environmentId: EnvironmentId;
  primaryEnvironmentId: EnvironmentId | null;
}): "local" | "remote" {
  return input.primaryEnvironmentId !== null && input.environmentId === input.primaryEnvironmentId
    ? "local"
    : "remote";
}

export function resolveDroppedFolderPath(
  folder: File,
  getPathForFile: ((file: File) => string) | undefined,
): string | null {
  const path = getPathForFile?.(folder);
  return typeof path === "string" && path.length > 0 ? path : null;
}

/** Separate dropped folders from dropped files; browsers report both as `File`. */
export function splitDroppedItems(dataTransfer: {
  readonly files: Iterable<File>;
  readonly items?: Iterable<DroppedItem>;
}): { files: File[]; folders: File[] } {
  if (dataTransfer.items === undefined) {
    return { files: Array.from(dataTransfer.files), folders: [] };
  }
  const files: File[] = [];
  const folders: File[] = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file === null) continue;
    if (item.webkitGetAsEntry()?.isDirectory === true) {
      folders.push(file);
    } else {
      files.push(file);
    }
  }
  return { files, folders };
}
