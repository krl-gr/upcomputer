import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { lazy, Suspense } from "react";

import { primaryServerAvailableEditorsAtom, primaryServerKeybindingsAtom } from "~/state/server";

import { FileSurfaceLoading } from "./fileSurfaceChrome";

const FilePreviewPanel = lazy(() => import("./FilePreviewPanel"));

export interface StandaloneFileTarget {
  /** A host path, or "" for the project folder. */
  readonly path: string;
  readonly line?: number | undefined;
  /** Grows with every open, so the same line can be revealed twice. */
  readonly requestId: number;
  readonly folderTrail?: string | undefined;
}

/**
 * Chat's file viewer outside a thread: read-only, files load through the environment and the
 * project folder. Links and folders inside it move this same viewer.
 */
export function StandaloneFileViewer(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly projectId?: ProjectId | undefined;
  readonly target: StandaloneFileTarget;
  readonly onNavigate: (target: Omit<StandaloneFileTarget, "requestId">) => void;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const { target, onNavigate } = props;

  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      <FilePreviewPanel
        key={`${props.environmentId}:${props.cwd}`}
        environmentId={props.environmentId}
        cwd={props.cwd}
        projectName={props.projectName}
        projectId={props.projectId}
        relativePath={target.path === "" ? null : target.path}
        keybindings={keybindings}
        availableEditors={availableEditors}
        openInShortcutEnabled={false}
        revealLine={target.line ?? null}
        revealRequestId={target.requestId}
        onOpenFile={(path) => onNavigate({ path })}
        onOpenFileLink={(path, line) => onNavigate({ path, line })}
        fileExplorer={false}
        markdownRenderedByDefault
        onNavigateFolder={(path, folderTrail) =>
          onNavigate({ path, ...(folderTrail === path ? {} : { folderTrail }) })
        }
        folderTrail={target.folderTrail}
        onPendingChange={() => {}}
        selectedFilePending={false}
        workspaceMutationId={null}
      />
    </Suspense>
  );
}
