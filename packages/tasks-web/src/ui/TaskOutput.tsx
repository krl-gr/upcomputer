import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { AssistantMessageMarkdown } from "../../../../apps/web/src/components/chat/AssistantMessageMarkdown.tsx";

/**
 * A task's output, rendered as an agent's reply in chat. A task has no thread, so its host files
 * load through its environment and project, and file links open in `filePanelRef`'s panel.
 */
export function TaskOutput(props: {
  readonly text: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly filePanelRef?: ScopedThreadRef | undefined;
  /** Without a panel beside it (the Tasks page), a file link opens through here. */
  readonly onOpenFile?: ((path: string, line?: number) => void) | undefined;
}) {
  return (
    <AssistantMessageMarkdown
      text={props.text}
      cwd={props.cwd}
      environmentId={props.environmentId}
      filePanelRef={
        props.filePanelRef?.environmentId === props.environmentId ? props.filePanelRef : undefined
      }
      onOpenFile={props.onOpenFile}
      className="px-3 py-2 text-lg leading-8 text-foreground"
    />
  );
}
