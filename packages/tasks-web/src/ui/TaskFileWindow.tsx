import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
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
import { DIALOG_POPUP_CLASS } from "../../../../apps/web/src/components/ui/dialog-styles.ts";
import { Sheet, SheetPopup, SheetTitle } from "../../../../apps/web/src/components/ui/sheet.tsx";
import { useCopyToClipboard } from "../../../../apps/web/src/hooks/useCopyToClipboard.ts";
import { useMediaQuery } from "../../../../apps/web/src/hooks/useMediaQuery.ts";
import { useTheme } from "../../../../apps/web/src/hooks/useTheme.ts";
import { cn } from "../../../../apps/web/src/lib/utils.ts";

/**
 * Design prototype: three sizes of one window, picked with
 * `localStorage["upcomputer.design.taskFileWindow"]` until one is chosen.
 */
// center: modal, document width (center-wide: most of the viewport). sheet: on the right, as wide
// as chat's panel. float: dragged by its title, like a planner task. Sheet and float are not modal.
type TaskFileWindowDesign = "center" | "center-wide" | "sheet" | "float";

const DESIGN_STORAGE_KEY = "upcomputer.design.taskFileWindow";
const FLOAT_WIDTH = 760;
const FLOAT_MARGIN = 8;

function readDesign(): TaskFileWindowDesign {
  try {
    const stored = window.localStorage.getItem(DESIGN_STORAGE_KEY);
    return stored === "sheet" || stored === "float" || stored === "center-wide" ? stored : "center";
  } catch {
    return "center";
  }
}

function fileName(path: string, projectName: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment !== "") ?? projectName;
}

interface TaskFileWindowProps {
  readonly environmentId: EnvironmentId;
  /** The task's project folder: relative links resolve against it. */
  readonly cwd: string;
  readonly projectName: string;
  readonly projectId?: ProjectId | undefined;
  readonly target: StandaloneFileTarget;
  readonly onNavigate: (target: Omit<StandaloneFileTarget, "requestId">) => void;
  readonly onClose: () => void;
  /** Opens the file in the task's latest worker thread, where it can be commented on. */
  readonly onOpenInThread?: (() => void) | undefined;
}

function FileWindowTitle(props: TaskFileWindowProps & { readonly compact: boolean }) {
  const { resolvedTheme } = useTheme();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "path" });
  const absolutePath =
    props.target.path === "" ? props.cwd : resolvePathLinkTarget(props.target.path, props.cwd);
  return (
    <>
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
      {props.onOpenInThread ? (
        props.compact ? (
          <FileSurfaceAction label="Open in the worker's thread" onPress={props.onOpenInThread}>
            <MessagesSquareIcon className="size-3.5" />
          </FileSurfaceAction>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={props.onOpenInThread}>
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
    </>
  );
}

const TITLE_ROW_CLASS = "flex h-11 shrink-0 items-center gap-2 border-b border-border/60 pr-2 pl-3";

function FileWindowBody(props: TaskFileWindowProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-task-file-window-body>
      <StandaloneFileViewer
        environmentId={props.environmentId}
        cwd={props.cwd}
        projectName={props.projectName}
        projectId={props.projectId}
        target={props.target}
        onNavigate={props.onNavigate}
      />
    </div>
  );
}

/**
 * Sheet and floating windows leave the page usable, so they are not modal: Escape closes the
 * window before it can leave the task, and focus returns to the link that opened it.
 */
function useNonModalWindow(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves focus into the window and takes Escape from the page while it is open
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // An open menu, picker or modal above the window (the image viewer) takes Escape first.
      if (
        document.querySelector(
          '[role="menu"], [role="listbox"], [data-slot="dialog-popup"], [data-slot="sheet-popup"]',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

function SheetWindow(props: TaskFileWindowProps) {
  const ref = useNonModalWindow(props.onClose);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`File ${fileName(props.target.path, props.projectName)}`}
      tabIndex={-1}
      data-task-file-window="sheet"
      className="fixed inset-y-0 right-0 z-40 flex w-[clamp(540px,40vw,720px)] flex-col border-l border-border bg-background text-foreground shadow-[-24px_0_64px_-32px_rgb(0_0_0/45%)] outline-none"
    >
      <div className={TITLE_ROW_CLASS}>
        <FileWindowTitle {...props} compact />
      </div>
      <FileWindowBody {...props} />
    </div>,
    document.body,
  );
}

function clampFloat(position: { x: number; y: number }) {
  return {
    x: Math.min(
      Math.max(position.x, FLOAT_MARGIN),
      Math.max(FLOAT_MARGIN, window.innerWidth - FLOAT_WIDTH - FLOAT_MARGIN),
    ),
    y: Math.min(
      Math.max(position.y, FLOAT_MARGIN),
      Math.max(FLOAT_MARGIN, window.innerHeight - 120),
    ),
  };
}

/** The planner's floating task window, with the viewer running edge to edge. */
function FloatWindow(props: TaskFileWindowProps) {
  const ref = useNonModalWindow(props.onClose);
  // Opens over the details column, so the output and its other links stay in view.
  const [position, setPosition] = useState(() =>
    clampFloat({ x: window.innerWidth - FLOAT_WIDTH - 24, y: 64 }),
  );
  const dragging = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);
  const interactive = (event: PointerEvent<HTMLElement>) =>
    (event.target as Element).closest("button, a, input, [data-prevent-drag]") !== null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`File ${fileName(props.target.path, props.projectName)}`}
      tabIndex={-1}
      data-task-file-window="float"
      className={cn(
        DIALOG_POPUP_CLASS,
        "fixed z-40 flex h-[min(46rem,calc(100dvh-6rem))] flex-col overflow-hidden shadow-xl",
      )}
      style={{ left: position.x, top: position.y, width: FLOAT_WIDTH }}
    >
      <div
        className={cn(TITLE_ROW_CLASS, "cursor-move select-none")}
        onPointerDown={(event) => {
          if (interactive(event)) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = {
            dx: event.clientX - position.x,
            dy: event.clientY - position.y,
            pointerId: event.pointerId,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragging.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          setPosition(clampFloat({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }));
        }}
        onPointerUp={(event) => {
          if (dragging.current?.pointerId === event.pointerId) dragging.current = null;
        }}
      >
        <FileWindowTitle {...props} compact={false} />
      </div>
      <FileWindowBody {...props} />
    </div>,
    document.body,
  );
}

const FIT_MIN_HEIGHT = 200;

/**
 * Prototype of "the window is as tall as a short file": it opens small and grows to its
 * content. A real build would size from the line count before the first paint.
 */
function useFittedHeight(enabled: boolean, path: string) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState({ path, height: FIT_MIN_HEIGHT });
  const height = fitted.path === path ? fitted.height : FIT_MIN_HEIGHT;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the viewer's scroll height in the DOM while the file loads
  useEffect(() => {
    if (!enabled) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 40) window.clearInterval(timer);
      const body = bodyRef.current;
      if (!body) return;
      const scroller = [
        ...body.querySelectorAll<HTMLElement>(
          ".file-preview-virtualizer, [data-slot='scroll-area-viewport'], [role='alert']",
        ),
      ].sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (!scroller || scroller.clientHeight < 40) return;
      const popup = body.closest<HTMLElement>("[data-task-file-window]");
      if (!popup) return;
      const wanted = Math.min(
        window.innerHeight - 64,
        popup.offsetHeight - scroller.clientHeight + scroller.scrollHeight,
      );
      setFitted((current) => {
        const base = current.path === path ? current.height : FIT_MIN_HEIGHT;
        return wanted > base + 1 ? { path, height: wanted } : current;
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, [enabled, path]);
  return { bodyRef, height: enabled ? height : null };
}

function readFit(): boolean {
  try {
    return window.localStorage.getItem(`${DESIGN_STORAGE_KEY}.fit`) === "1";
  } catch {
    return false;
  }
}

function CenterWindow(props: TaskFileWindowProps & { readonly wide: boolean }) {
  const [fit] = useState(readFit);
  const { bodyRef, height } = useFittedHeight(fit, props.target.path);
  // Focus starts on the window, not on its first button: Enter must not jump to the thread.
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup
        ref={popupRef}
        initialFocus={popupRef}
        showCloseButton={false}
        bottomStickOnMobile={false}
        data-task-file-window="center"
        className={cn(
          "max-h-none max-w-none overflow-hidden",
          height === null && "h-[calc(100dvh-4rem)]",
          props.wide ? "w-[min(74rem,calc(100vw-4rem))]" : "w-[min(64rem,calc(100vw-4rem))]",
        )}
        style={height === null ? undefined : { height }}
      >
        <DialogTitle className="sr-only">
          File {fileName(props.target.path, props.projectName)}
        </DialogTitle>
        <div className={TITLE_ROW_CLASS}>
          <FileWindowTitle {...props} compact={false} />
        </div>
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
          <FileWindowBody {...props} />
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** A phone has room for one size: the bottom sheet a planner task opens in. */
function PhoneWindow(props: TaskFileWindowProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetPopup
        ref={popupRef}
        initialFocus={popupRef}
        side="bottom"
        showCloseButton={false}
        className="h-[92dvh]"
        data-task-file-window="phone"
      >
        <SheetTitle className="sr-only">
          File {fileName(props.target.path, props.projectName)}
        </SheetTitle>
        <div className={TITLE_ROW_CLASS}>
          <FileWindowTitle {...props} compact />
        </div>
        <FileWindowBody {...props} />
      </SheetPopup>
    </Sheet>
  );
}

/** Prototype only: shows "Open in the worker's thread" for a seeded task that has no runs. */
export function designDemoThreadAction(): boolean {
  try {
    return window.localStorage.getItem(`${DESIGN_STORAGE_KEY}.thread`) === "1";
  } catch {
    return false;
  }
}

/** A file from a task's output, in chat's file viewer, in a window over the Tasks page. */
export function TaskFileWindow(props: TaskFileWindowProps) {
  const desktop = useMediaQuery("md");
  const [design] = useState(readDesign);
  if (!desktop) return <PhoneWindow {...props} />;
  if (design === "sheet") return <SheetWindow {...props} />;
  if (design === "float") return <FloatWindow {...props} />;
  return <CenterWindow {...props} wide={design === "center-wide"} />;
}
