import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { DIALOG_POPUP_CLASS } from "../../../../../apps/web/src/components/ui/dialog-styles.ts";
import { Sheet, SheetPopup } from "../../../../../apps/web/src/components/ui/sheet.tsx";
import { useMediaQuery } from "../../../../../apps/web/src/hooks/useMediaQuery.ts";
import type { WindowPosition } from "../windows/windowStore.ts";

const PADDING = 8;

function clampToViewport(position: WindowPosition, width: number): WindowPosition {
  return {
    x: Math.min(
      Math.max(position.x, PADDING),
      Math.max(PADDING, window.innerWidth - width - PADDING),
    ),
    y: Math.min(Math.max(position.y, PADDING), Math.max(PADDING, window.innerHeight - 120)),
  };
}

/** Centred, with a small random offset so new windows do not stack exactly (wande). */
function defaultPosition(width: number): WindowPosition {
  return clampToViewport(
    {
      x: Math.round(window.innerWidth / 2 - width / 2 + Math.random() * 60 - 30),
      y: Math.round(window.innerHeight / 2 - 240 + Math.random() * 60 - 30),
    },
    width,
  );
}

const INTERACTIVE =
  'input, textarea, select, button, a, [contenteditable="true"], [data-prevent-drag]';

/**
 * Wande's FloatingWindow: a non-modal window over the page with the dialog
 * surface, dragged by its header and kept inside the viewport, not resizable.
 * Several can be open; pressing one raises it. Below the `md` breakpoint it is
 * a bottom sheet instead.
 */
export function FloatingWindow(props: {
  readonly width: number;
  readonly zIndex: number;
  readonly position: WindowPosition | undefined;
  readonly header: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onFocus: () => void;
  readonly onMove: (position: WindowPosition) => void;
  /** Sheet mode only: the sheet was dismissed. */
  readonly onDismiss: () => void;
}) {
  const desktop = useMediaQuery("md");
  const [position, setPosition] = useState<WindowPosition>(
    () => props.position ?? defaultPosition(props.width),
  );
  const dragging = useRef<{
    dx: number;
    dy: number;
    pointerId: number;
    position: WindowPosition;
  } | null>(null);
  // A new window reports where it opened, so it reopens there after leaving /tasks.
  const reportOpened = useEffectEvent(() => {
    if (!props.position) props.onMove(position);
  });
  useEffect(() => {
    reportOpened();
  }, []);
  useEffect(() => {
    const onResize = () => setPosition((current) => clampToViewport(current, props.width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [props.width]);

  if (!desktop)
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) props.onDismiss();
        }}
      >
        <SheetPopup side="bottom" showCloseButton={false} className="h-[90dvh]">
          <div className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-2">{props.header}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{props.children}</div>
          {props.footer ? <div className="shrink-0 px-4 pb-4">{props.footer}</div> : null}
        </SheetPopup>
      </Sheet>
    );

  return createPortal(
    <div
      role="dialog"
      className={cn(DIALOG_POPUP_CLASS, "fixed flex max-h-[85vh] flex-col shadow-xl")}
      style={{ left: position.x, top: position.y, width: props.width, zIndex: props.zIndex }}
      onPointerDownCapture={(event) => {
        if (!(event.target as Element).closest(INTERACTIVE)) props.onFocus();
      }}
    >
      <div
        className="flex shrink-0 cursor-move items-start gap-2 px-4 pt-4 pb-2 select-none"
        onPointerDown={(event) => {
          if ((event.target as Element).closest(INTERACTIVE)) return;
          event.preventDefault();
          props.onFocus();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = {
            dx: event.clientX - position.x,
            dy: event.clientY - position.y,
            pointerId: event.pointerId,
            position,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragging.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          drag.position = clampToViewport(
            { x: event.clientX - drag.dx, y: event.clientY - drag.dy },
            props.width,
          );
          setPosition(drag.position);
        }}
        onPointerUp={(event) => {
          const drag = dragging.current;
          if (drag?.pointerId !== event.pointerId) return;
          dragging.current = null;
          props.onMove(drag.position);
        }}
      >
        {props.header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{props.children}</div>
      {props.footer ? <div className="shrink-0 px-4 pb-4">{props.footer}</div> : null}
    </div>,
    document.body,
  );
}
