import { useLocation } from "@tanstack/react-router";
import { T } from "gt-react";

import { undoLatestThreadAction } from "../../hooks/showThreadUndoNotice";
import { cn } from "../../lib/utils";
import { Kbd } from "../ui/kbd";
import { isMobileViewport, useSidebar } from "../ui/sidebar";
import { isAppModalPage } from "./mainAppLocation";
import { useThreadUndoNoticeView } from "./threadUndoNoticeView.upcomputer";
import "./phoneUndoNotice.css";

/**
 * Whether the page itself shows the thread undo notice: at phone width with the sidebar
 * sheet closed. The open sheet shows the sidebar's own pill instead, and Settings and
 * Usage cover the page.
 */
function phoneUndoNoticeShown(input: {
  readonly isMobile: boolean;
  readonly openMobile: boolean;
  readonly modalPage: boolean;
}): boolean {
  return input.isMobile && !input.openMobile && !input.modalPage;
}

/**
 * Whether a thread undo notice is on screen for Cmd+Z: the sidebar's pill, or at phone
 * width the page card while the sheet is closed. Its caller already skips Settings and Usage.
 */
export function threadUndoNoticeOnScreen(readSidebarVisible: () => boolean): boolean {
  return readSidebarVisible() || isMobileViewport();
}

// The sidebar pill's motion: 180ms, 6px toward its resting place on the way in, back on the way out.
const MOTION =
  "transform-gpu transition-all duration-180 ease-drawer will-change-transform starting:-translate-y-1.5 starting:opacity-0";

function PhoneUndoNoticeCard(props: {
  readonly view: NonNullable<ReturnType<typeof useThreadUndoNoticeView>>;
  readonly hidden: boolean;
}) {
  const { view } = props;
  const Icon = view.icon;
  return (
    <div
      data-phone-undo-notice=""
      aria-hidden={props.hidden || undefined}
      inert={props.hidden}
      // One gap under the header, clear of its buttons. Toasts stack below it (phoneUndoNotice.css).
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+var(--workspace-topbar-height)+--spacing(2))] z-40 flex justify-center px-4"
    >
      <div
        data-phone-undo-motion=""
        className={cn(
          "flex h-11 max-w-full items-center rounded-2xl border bg-popover pr-1.5 pl-3.5 text-sm font-medium text-popover-foreground shadow-lg/10 not-dark:bg-clip-padding",
          MOTION,
          props.hidden
            ? "-translate-y-1.5 opacity-0"
            : "pointer-events-auto translate-y-0 opacity-100",
        )}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate pr-4 pl-2">{view.label}</span>
        <button
          type="button"
          onClick={undoLatestThreadAction}
          // On touch the target grows to the card's full 44px height; the look stays.
          className="relative flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-sidebar-control-surface px-3 outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-sidebar-row-hover pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1.5 pointer-coarse:after:-inset-y-1.5"
        >
          <T>Undo</T>
          {view.shortcut ? (
            // A touch screen has no key to press.
            <span className="flex pointer-coarse:hidden">
              <Kbd>{view.shortcut}</Kbd>
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

/** The thread undo notice under the header, for phone width with the sidebar sheet closed. */
export function PhoneUndoNotice() {
  const { isMobile, openMobile } = useSidebar();
  const modalPage = useLocation({ select: (location) => isAppModalPage(location.pathname) });
  const view = useThreadUndoNoticeView();
  if (!isMobile || modalPage || !view) return null;
  // Stays mounted while the sheet is open, so closing it brings the notice back with its motion.
  const shown = phoneUndoNoticeShown({ isMobile, openMobile, modalPage });
  return <PhoneUndoNoticeCard view={view} hidden={view.exiting || !shown} />;
}
