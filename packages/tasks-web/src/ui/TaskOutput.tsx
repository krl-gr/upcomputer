import { useState } from "react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import { AssistantMessageMarkdown } from "../../../../apps/web/src/components/chat/AssistantMessageMarkdown.tsx";
import type { StandaloneFileTarget } from "../../../../apps/web/src/components/files/StandaloneFileViewer.tsx";
import { TaskFileWindow, type TaskFileWindowProps } from "./TaskFileWindow.tsx";

/**
 * A task's output, rendered as an agent's reply in chat. A task has no thread, so its host files
 * load through its environment and project. File links open in `filePanelRef`'s panel, or
 * without one in a file window over the page.
 */
export function TaskOutput(props: {
  readonly text: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly filePanelRef?: ScopedThreadRef | undefined;
  readonly fileWindow?:
    | {
        readonly projectName: string;
        readonly projectId?: ProjectId | undefined;
        readonly onOpenInThread?: TaskFileWindowProps["onOpenInThread"];
      }
    | undefined;
}) {
  const [openFile, setOpenFile] = useState<StandaloneFileTarget | null>(null);
  const filePanelRef =
    props.filePanelRef?.environmentId === props.environmentId ? props.filePanelRef : undefined;
  const { cwd, fileWindow } = props;
  const opensWindow = filePanelRef === undefined && fileWindow !== undefined && cwd !== undefined;
  // The id grows with every open, so a second click on the same line reveals it again.
  const open = (target: Omit<StandaloneFileTarget, "requestId">) =>
    setOpenFile((current) => ({ ...target, requestId: (current?.requestId ?? 0) + 1 }));
  return (
    <>
      <AssistantMessageMarkdown
        text={props.text}
        cwd={cwd}
        environmentId={props.environmentId}
        filePanelRef={filePanelRef}
        onOpenFile={opensWindow ? (path, line) => open({ path, line }) : undefined}
        className="px-3 py-2 text-lg leading-8 text-foreground"
      />
      {opensWindow && openFile ? (
        <TaskFileWindow
          environmentId={props.environmentId}
          cwd={cwd}
          projectName={fileWindow.projectName}
          projectId={fileWindow.projectId}
          target={openFile}
          onNavigate={open}
          onClose={() => setOpenFile(null)}
          onOpenInThread={fileWindow.onOpenInThread}
        />
      ) : null}
    </>
  );
}
