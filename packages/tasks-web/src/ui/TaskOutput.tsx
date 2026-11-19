import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  ASSISTANT_CITATION_TASK_TITLE_LENGTH,
  type AssistantCitation,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { QuoteIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AssistantMessageMarkdown } from "../../../../apps/web/src/components/chat/AssistantMessageMarkdown.tsx";
import { AssistantSelectionToolbar } from "../../../../apps/web/src/components/chat/AssistantSelectionToolbar.tsx";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "../../../../apps/web/src/components/ui/tooltip.tsx";
import { formatAssistantCitationForComposer } from "../../../../apps/web/src/composer-logic.ts";
import { useComposerDraftStore } from "../../../../apps/web/src/composerDraftStore.ts";
import { useComposerHandleContext } from "../../../../apps/web/src/composerHandleContext.ts";
import { useNewThreadHandler } from "../../../../apps/web/src/hooks/useHandleNewThread.ts";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "../../../../apps/web/src/lib/assistantTextSelection.ts";
import { useThreadShell } from "../../../../apps/web/src/state/entities.ts";

/** The task an output belongs to, as a quote from it names it. */
export interface TaskOutputQuoteSource {
  readonly id: string;
  readonly title: string;
  readonly projectId: ProjectId;
  /** The chat that created the task, where a quote goes from the Tasks page. */
  readonly sourceThreadId: ThreadId | null;
}

/** The blocks a quote button offers: a list item, or a paragraph outside one. */
function quotableBlock(target: EventTarget | null, source: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element) || !source.contains(target)) return null;
  const block = target.closest<HTMLElement>("li") ?? target.closest<HTMLElement>("p");
  return block && source.contains(block) && block.textContent?.trim() ? block : null;
}

/**
 * A task's output, rendered as an agent's reply in chat. A task has no thread, so its host files
 * load through its environment and project, and file links open in `filePanelRef`'s panel.
 * With `quoteSource`, its text is cited into a chat the way a chat reply is.
 */
export function TaskOutput(props: {
  readonly text: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly filePanelRef?: ScopedThreadRef | undefined;
  readonly quoteSource?: TaskOutputQuoteSource | undefined;
  readonly onOpenThread?: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  const markdown = (
    <AssistantMessageMarkdown
      text={props.text}
      cwd={props.cwd}
      environmentId={props.environmentId}
      filePanelRef={
        props.filePanelRef?.environmentId === props.environmentId ? props.filePanelRef : undefined
      }
      // The quote button stands at the right of a block's first line, in room kept free of text.
      className={`${props.quoteSource ? "pr-9 pl-3" : "px-3"} py-2 text-lg leading-8 text-foreground`}
    />
  );
  return props.quoteSource ? (
    <QuotableTaskOutput
      environmentId={props.environmentId}
      task={props.quoteSource}
      panelThreadRef={props.filePanelRef}
      onOpenThread={props.onOpenThread}
    >
      {markdown}
    </QuotableTaskOutput>
  ) : (
    markdown
  );
}

function QuotableTaskOutput(props: {
  readonly environmentId: EnvironmentId;
  readonly task: TaskOutputQuoteSource;
  readonly panelThreadRef: ScopedThreadRef | undefined;
  readonly onOpenThread: ((environmentId: EnvironmentId, threadId: ThreadId) => void) | undefined;
  readonly children: React.ReactNode;
}) {
  const { environmentId, task, panelThreadRef, onOpenThread } = props;
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [block, setBlock] = useState<HTMLElement | null>(null);
  const composerRef = useComposerHandleContext();
  const newThread = useNewThreadHandler();
  const sourceThreadRef = useMemo(
    () => (task.sourceThreadId ? scopeThreadRef(environmentId, task.sourceThreadId) : null),
    [environmentId, task.sourceThreadId],
  );
  const sourceThread = useThreadShell(sourceThreadRef);
  const sourceThreadOpen = sourceThread !== null && sourceThread.deletedAt === null;
  const taskSource = useMemo(
    () => ({
      environmentId,
      taskId: task.id,
      taskTitle: task.title.slice(0, ASSISTANT_CITATION_TASK_TITLE_LENGTH),
    }),
    [environmentId, task.id, task.title],
  );

  const cite = (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => {
    if (panelThreadRef) {
      const inserted = composerRef?.current?.citeAssistantText(citation, sourceAnchor) ?? false;
      if (!inserted) {
        toastManager.add({
          type: "warning",
          title: "The composer is not ready",
          description:
            "Try citing the selection after the connection or pending input is resolved.",
        });
      }
      return inserted;
    }
    const quote = formatAssistantCitationForComposer(citation);
    const store = useComposerDraftStore.getState();
    const appendTo = (target: Parameters<typeof store.setPrompt>[0]) => {
      const prompt = store.getComposerDraft(target)?.prompt ?? "";
      if (prompt.includes(quote.trim())) return;
      store.setPrompt(target, `${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}${quote}`);
    };
    if (sourceThreadRef && sourceThreadOpen && onOpenThread) {
      appendTo(sourceThreadRef);
      onOpenThread(sourceThreadRef.environmentId, sourceThreadRef.threadId);
      return true;
    }
    // No chat created this task: a new chat in its project takes the quote.
    void newThread(scopeProjectRef(environmentId, task.projectId), { prompt: quote }).then(
      (draft) => draft && appendTo(draft.draftId),
    );
    return true;
  };

  const citeBlock = (target: HTMLElement) => {
    const selection = window.getSelection();
    if (!viewport || !selection) return;
    // The same capture a selection gets, so a block quote and a selected quote are one kind.
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    const captured = captureAssistantTextSelection(viewport, selection);
    selection.removeAllRanges();
    if (!captured) return;
    if (captured.selector.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) {
      toastManager.add({
        type: "warning",
        title: "This part is too long to quote",
        description: "Select a shorter piece of it instead.",
      });
      return;
    }
    cite(
      { version: 1, ...taskSource, ...captured.selector },
      { source: captured.source, range: captured.range, viewport },
    );
    setBlock(null);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the pointer over the output's DOM to place the quote button beside the block under it
  useEffect(() => {
    const source = sourceRef.current;
    if (!viewport || !source) return;
    // The block is found by height, so the pointer can travel from its text to its button.
    const blockAt = (clientY: number) => {
      const bounds = source.getBoundingClientRect();
      return quotableBlock(
        document.elementFromPoint(bounds.left + bounds.width / 2, clientY),
        source,
      );
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      // Selected text has its own Cite button.
      const selection = window.getSelection();
      const selecting =
        selection !== null && !selection.isCollapsed && source.contains(selection.anchorNode);
      setBlock(selecting || event.buttons !== 0 ? null : blockAt(event.clientY));
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") setBlock(null);
    };
    // Touch has no hover: a tap on a block shows its button, a tap elsewhere hides it.
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      const interactive = (event.target as Element).closest?.("a, button, summary, input");
      const tapped =
        interactive || !source.contains(event.target as Node) ? null : blockAt(event.clientY);
      setBlock((current) => (tapped === current ? null : tapped));
    };
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, [viewport]);

  const destination = panelThreadRef
    ? "Cite in chat"
    : sourceThreadOpen
      ? `Cite in "${sourceThread.title}"`
      : "Cite in a new chat";
  const top =
    block && viewport && block.isConnected
      ? block.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      : null;

  return (
    <div ref={setViewport} data-assistant-citation-viewport="true" className="relative">
      <div
        ref={sourceRef}
        data-assistant-citation-source={task.id}
        data-assistant-citation-environment={environmentId}
        data-task-output-quote-block={block ? "true" : undefined}
      >
        {props.children}
      </div>
      {top !== null && block ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                ref={buttonRef}
                type="button"
                data-task-output-quote-button="true"
                aria-label={`${destination}: this part`}
                className="absolute right-1.5 flex size-6 items-center justify-center rounded-md border border-border bg-popover text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground"
                style={{ top: top + 4 }}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => citeBlock(block)}
              />
            }
          >
            <QuoteIcon aria-hidden="true" className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>{destination}</TooltipPopup>
        </Tooltip>
      ) : null}
      <AssistantSelectionToolbar viewport={viewport} taskSource={taskSource} onCite={cite} />
    </div>
  );
}
