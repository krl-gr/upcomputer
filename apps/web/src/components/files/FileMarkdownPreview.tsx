import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";

export function FileMarkdownPreview(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  /** Without a thread, files load through `environmentId` and links go to `onOpenFile`. */
  readonly threadRef: ScopedThreadRef | undefined;
  readonly environmentId?: EnvironmentId | undefined;
  readonly onOpenFile?: ((path: string, line?: number) => void) | undefined;
  readonly workspaceMutationId: string | null;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  const lastSeparator = Math.max(
    props.relativePath.lastIndexOf("/"),
    props.relativePath.lastIndexOf("\\"),
  );
  const imageBaseDir =
    lastSeparator >= 0
      ? resolvePathLinkTarget(props.relativePath.slice(0, lastSeparator), props.cwd)
      : props.cwd;

  return (
    <ChatMarkdown
      text={maskMarkdownFrontmatter(props.text)}
      cwd={props.cwd}
      imageBaseDir={imageBaseDir}
      threadRef={props.threadRef}
      environmentId={props.threadRef ? undefined : props.environmentId}
      onOpenFile={props.threadRef ? undefined : props.onOpenFile}
      workspaceMutationId={props.workspaceMutationId}
      className="mx-auto max-w-4xl px-6 py-5"
      onTaskListChange={props.onTaskListChange}
    />
  );
}
