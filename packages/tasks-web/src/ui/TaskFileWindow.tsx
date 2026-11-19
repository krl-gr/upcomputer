import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, MessagesSquareIcon, XIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";

import { WorkspaceEntryIcon } from "../../../../apps/web/src/components/chat/WorkspaceEntryIcon.tsx";
import {
  StandaloneFileViewer,
  type StandaloneFileTarget,
} from "../../../../apps/web/src/components/files/StandaloneFileViewer.tsx";
import { FileSurfaceAction } from "../../../../apps/web/src/components/files/fileSurfaceChrome.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
} from "../../../../apps/web/src/components/ui/dialog.tsx";
import { Sheet, SheetPopup, SheetTitle } from "../../../../apps/web/src/components/ui/sheet.tsx";
import { useCopyToClipboard } from "../../../../apps/web/src/hooks/useCopyToClipboard.ts";
import { useMediaQuery } from "../../../../apps/web/src/hooks/useMediaQuery.ts";
import { useTheme } from "../../../../apps/web/src/hooks/useTheme.ts";

function fileName(path: string, projectName: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment !== "") ?? projectName;
}

export interface TaskFileWindowProps {
  readonly environmentId: EnvironmentId;
  /** The task's project folder: relative links resolve against it. */
  readonly cwd: string;
  readonly projectName: string;
  readonly projectId?: ProjectId | undefined;
  readonly target: StandaloneFileTarget;
  readonly onNavigate: (target: Omit<StandaloneFileTarget, "requestId">) => void;
  readonly onClose: () => void;
  /** Opens the file in the task's latest worker thread, where it can be commented on. */
  readonly onOpenInThread?: ((absolutePath: string, line: number | undefined) => void) | undefined;
}

function FileWindowTitle(props: TaskFileWindowProps & { readonly compact: boolean }) {
  const { resolvedTheme } = useTheme();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "path" });
  const absolutePath =
    props.target.path === "" ? props.cwd : resolvePathLinkTarget(props.target.path, props.cwd);
  const onOpenInThread = props.onOpenInThread;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 pr-2 pl-3">
      <span className="flex size-4 shrink-0 items-center justify-center">
        <WorkspaceEntryIcon
          path={absolutePath}
          environmentId={props.environmentId}
          theme={resolvedTheme}
        />
      </span>
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {fileName(props.target.path, props.projectName)}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">Read only</span>
      <span className="min-w-2 flex-1" />
      {onOpenInThread ? (
        props.compact ? (
          <FileSurfaceAction
            label="Open in the worker's thread"
            onPress={() => onOpenInThread(absolutePath, props.target.line)}
          >
            <MessagesSquareIcon className="size-3.5" />
          </FileSurfaceAction>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenInThread(absolutePath, props.target.line)}
          >
            <MessagesSquareIcon />
            Open in the worker's thread
          </Button>
        )
      ) : null}
      <FileSurfaceAction
        label={isCopied ? "Copied" : "Copy path"}
        onPress={() => copyToClipboard(absolutePath, undefined)}
      >
        {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </FileSurfaceAction>
      <FileSurfaceAction label="Close" onPress={props.onClose}>
        <XIcon className="size-4" />
      </FileSurfaceAction>
    </div>
  );
}

const SCROLLER_SELECTOR =
  "[data-slot='scroll-area-viewport'], .file-preview-virtualizer, .overflow-auto, .overflow-y-auto";

/** The viewer's tallest element that scrolls, if its file has rendered yet. */
function findScroller(popup: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  for (const element of popup.querySelectorAll<HTMLElement>(SCROLLER_SELECTOR)) {
    if (element.scrollHeight <= element.clientHeight) continue;
    if (!best || element.clientHeight > best.clientHeight) best = element;
  }
  return best;
}

/**
 * Focus opens on the window, not on its first button, so Enter cannot jump to the thread. Once
 * a file renders, focus moves into its scroller so arrows, Space and Page Down scroll at once.
 * A link that moves the window removes the focused scroller, so this keeps watching.
 */
function useFocusIntoScroller(popup: HTMLDivElement | null) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches the viewer's DOM while the window is open and moves focus into the file it renders
  useEffect(() => {
    if (!popup) return;
    const tryFocus = () => {
      const active = document.activeElement;
      // Only while focus is nowhere in particular: never take it from a control the user chose.
      if (active !== popup && active !== document.body && active !== null) return;
      const scroller = findScroller(popup);
      if (!scroller) return;
      if (!scroller.hasAttribute("tabindex")) scroller.tabIndex = -1;
      scroller.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(tryFocus);
    observer.observe(popup, { childList: true, subtree: true });
    popup.addEventListener("focusin", tryFocus);
    tryFocus();
    return () => {
      observer.disconnect();
      popup.removeEventListener("focusin", tryFocus);
    };
  }, [popup]);
}

function FileWindowContent(props: TaskFileWindowProps & { readonly compact: boolean }) {
  return (
    <>
      <FileWindowTitle {...props} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <StandaloneFileViewer
          environmentId={props.environmentId}
          cwd={props.cwd}
          projectName={props.projectName}
          projectId={props.projectId}
          target={props.target}
          onNavigate={props.onNavigate}
        />
      </div>
    </>
  );
}

/**
 * A file from a task's output, in chat's file viewer, in a modal window over the Tasks page:
 * document width and the full height on a desktop, a bottom sheet like a planner task on a phone.
 * Escape closes only this window, and focus returns to the link that opened it.
 */
export function TaskFileWindow(props: TaskFileWindowProps) {
  const desktop = useMediaQuery("md");
  const popupRef = useRef<HTMLDivElement | null>(null);
  // The popup mounts through a portal, so the effect waits for the element itself.
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const attachPopup = useCallback((element: HTMLDivElement | null) => {
    popupRef.current = element;
    setPopup(element);
  }, []);
  useFocusIntoScroller(popup);
  const title = `File ${fileName(props.target.path, props.projectName)}`;
  const onOpenChange = (open: boolean) => {
    if (!open) props.onClose();
  };
  if (!desktop) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetPopup
          ref={attachPopup}
          initialFocus={popupRef}
          side="bottom"
          showCloseButton={false}
          className="h-[92dvh]"
          data-task-file-window="phone"
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <FileWindowContent {...props} compact />
        </SheetPopup>
      </Sheet>
    );
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup
        ref={attachPopup}
        initialFocus={popupRef}
        showCloseButton={false}
        bottomStickOnMobile={false}
        data-task-file-window="center"
        className="h-[calc(100dvh-4rem)] max-h-none w-[min(64rem,calc(100vw-4rem))] max-w-none overflow-hidden"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <FileWindowContent {...props} compact={false} />
      </DialogPopup>
    </Dialog>
  );
}
