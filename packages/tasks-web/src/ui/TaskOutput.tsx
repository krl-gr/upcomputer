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
import { useGT } from "gt-react";
import { QuoteIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AssistantMessageMarkdown } from "../../../../apps/web/src/components/chat/AssistantMessageMarkdown.tsx";
import { AssistantSelectionToolbar } from "../../../../apps/web/src/components/chat/AssistantSelectionToolbar.tsx";
import type { StandaloneFileTarget } from "../../../../apps/web/src/components/files/StandaloneFileViewer.tsx";
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
import { useOmittedThreadShell } from "./useOmittedThreadShell.ts";
import { TaskFileWindow, type TaskFileWindowProps } from "./TaskFileWindow.tsx";
import { promptQuotesPassage, taskQuoteTarget } from "./taskQuoteTarget.ts";

/** The comment a block's quote button replies with: approving that point in one click. */
const BLOCK_REPLY_COMMENT = "ok";

/** The task an output belongs to, as a quote from it names it. */
export interface TaskOutputQuoteSource {
  readonly id: string;
  readonly title: string;
  readonly projectId: ProjectId;
  /** The chat the task's chain started from, where a quote goes from the Tasks page. */
  readonly rootThreadId: ThreadId | null;
}

/** The blocks a quote button offers: a list item, or a paragraph outside one. */
function quotableBlock(target: EventTarget | null, source: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element) || !source.contains(target)) return null;
  const block = target.closest<HTMLElement>("li") ?? target.closest<HTMLElement>("p");
  return block && source.contains(block) && block.textContent?.trim() ? block : null;
}

/**
 * A task's output, rendered as an agent's reply in chat. A task has no thread, so its host files
 * load through its environment and project. File links open in `filePanelRef`'s panel, or
 * without one in a file window over the page.
 * With `quoteSource`, its text is cited into a chat the way a chat reply is.
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
  readonly quoteSource?: TaskOutputQuoteSource | undefined;
  readonly onOpenThread?: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  const [openFile, setOpenFile] = useState<StandaloneFileTarget | null>(null);
  const filePanelRef =
    props.filePanelRef?.environmentId === props.environmentId ? props.filePanelRef : undefined;
  const { cwd, fileWindow } = props;
  const opensWindow = filePanelRef === undefined && fileWindow !== undefined && cwd !== undefined;
  // The id grows with every open, so a second click on the same line reveals it again.
  const open = (target: Omit<StandaloneFileTarget, "requestId">) =>
    setOpenFile((current) => ({ ...target, requestId: (current?.requestId ?? 0) + 1 }));
  const markdown = (
    <AssistantMessageMarkdown
      text={props.text}
      cwd={cwd}
      environmentId={props.environmentId}
      filePanelRef={filePanelRef}
      onOpenFile={opensWindow ? (path, line) => open({ path, line }) : undefined}
      // The quote button stands at the right of a block's first line, in room kept free of text.
      className={`${props.quoteSource ? "pr-9 pl-3" : "px-3"} py-1.5 text-sm leading-relaxed text-foreground`}
    />
  );
  return (
    <>
      {props.quoteSource ? (
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
      )}
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

function QuotableTaskOutput(props: {
  readonly environmentId: EnvironmentId;
  readonly task: TaskOutputQuoteSource;
  readonly panelThreadRef: ScopedThreadRef | undefined;
  readonly onOpenThread: ((environmentId: EnvironmentId, threadId: ThreadId) => void) | undefined;
  readonly children: React.ReactNode;
}) {
  const { environmentId, task, panelThreadRef, onOpenThread } = props;
  const gt = useGT();
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [block, setBlock] = useState<HTMLElement | null>(null);
  const composerRef = useComposerHandleContext();
  const newThread = useNewThreadHandler();
  const rootThreadRef = useMemo(
    () => (task.rootThreadId ? scopeThreadRef(environmentId, task.rootThreadId) : null),
    [environmentId, task.rootThreadId],
  );
  const rootThread = useOmittedThreadShell(rootThreadRef, true);
  const target = taskQuoteTarget({
    besideThreadRef: panelThreadRef,
    environmentId,
    rootThreadId: task.rootThreadId,
    rootThread: rootThread && rootThread.deletedAt === null ? rootThread : null,
  });
  const taskSource = useMemo(
    () => ({
      environmentId,
      taskId: task.id,
      taskTitle: task.title.slice(0, ASSISTANT_CITATION_TASK_TITLE_LENGTH),
    }),
    [environmentId, task.id, task.title],
  );

  // A selection's Cite opens the comment box, as in chat. The quote button drops the quote with
  // its comment already written, and only once.
  const cite = (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
    options?: { readonly withComment?: boolean },
  ) => {
    const quote = formatAssistantCitationForComposer(citation, citation.comment);
    if (target.kind === "beside") {
      const composer = composerRef?.current;
      if (
        options?.withComment === false &&
        composer &&
        promptQuotesPassage(composer.readSnapshot().value, citation)
      ) {
        return true;
      }
      const inserted =
        options?.withComment === false
          ? (composer?.insertTextAtEnd(quote, { ensureLeadingBoundary: true }) ?? false)
          : (composer?.citeAssistantText(citation, sourceAnchor) ?? false);
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
    const store = useComposerDraftStore.getState();
    const appendTo = (draftTarget: Parameters<typeof store.setPrompt>[0]) => {
      const prompt = store.getComposerDraft(draftTarget)?.prompt ?? "";
      if (promptQuotesPassage(prompt, citation)) return;
      store.setPrompt(draftTarget, `${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}${quote}`);
    };
    if (target.kind === "root" && onOpenThread) {
      appendTo(target.threadRef);
      onOpenThread(target.threadRef.environmentId, target.threadRef.threadId);
      return true;
    }
    // A draft that already has text keeps it, so the quote is appended to it as well.
    void newThread(scopeProjectRef(environmentId, task.projectId), { prompt: quote }).then(
      (draft) => draft && appendTo(draft.draftId),
    );
    return true;
  };

  const citeBlock = (element: HTMLElement) => {
    const selection = window.getSelection();
    if (!viewport || !selection) return;
    // The same capture a selection gets, so a block quote and a selected quote are one kind.
    // The range runs from the block's first visible character to its last.
    const texts: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/\S/.test((node as Text).data)) texts.push(node as Text);
    }
    const first = texts[0];
    const last = texts.at(-1);
    if (!first || !last) return;
    const range = document.createRange();
    range.setStart(first, first.data.search(/\S/));
    range.setEnd(last, last.data.trimEnd().length);
    selection.removeAllRanges();
    selection.addRange(range);
    const captured = captureAssistantTextSelection(viewport, selection);
    selection.removeAllRanges();
    if (!captured) return;
    // Sub-items leave runs of blank lines. A source is found by its text with whitespace
    // collapsed, so one line break per run still finds it.
    const text = captured.selector.text.replace(/\s*\n\s*/g, "\n");
    if (text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) {
      toastManager.add({
        type: "warning",
        title: "This part is too long to quote",
        description: "Select a shorter piece of it instead.",
      });
      return;
    }
    cite(
      { version: 1, ...taskSource, ...captured.selector, text, comment: BLOCK_REPLY_COMMENT },
      { source: captured.source, range: captured.range, viewport },
      { withComment: false },
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

  const reply =
    target.kind === "beside"
      ? gt('Reply "ok" in chat')
      : target.kind === "root"
        ? gt('Reply "ok" in "{title}"', { title: target.title })
        : gt('Reply "ok" in a new chat');
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
                aria-label={reply}
                className="absolute right-1.5 flex size-6 items-center justify-center rounded-md border border-border bg-popover text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground"
                style={{ top }}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => citeBlock(block)}
              />
            }
          >
            <QuoteIcon aria-hidden="true" className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>{reply}</TooltipPopup>
        </Tooltip>
      ) : null}
      <AssistantSelectionToolbar viewport={viewport} taskSource={taskSource} onCite={cite} />
    </div>
  );
}
