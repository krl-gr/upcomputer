import { TriangleAlertIcon } from "lucide-react";
import type { DesktopBridge } from "@t3tools/contracts";
import { type ReactNode, useId, useState } from "react";

import { isElectron } from "../../env";
import { undoLatestThreadAction } from "../../hooks/showThreadUndoNotice";
import { cn } from "../../lib/utils";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { confirmAndInstallLocalUpdate } from "../../sidebarNotifications/useSidebarUpdates";
import {
  getArm64IntelBuildWarningDescription,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
} from "../desktopUpdate.logic";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarCompactUndoNotice } from "./SidebarCompactUndoNotice.upcomputer";
import { downloadLocalUpdate } from "./SidebarUpdatePill";
import { useThreadUndoNoticeView } from "./threadUndoNoticeView.upcomputer";

const PILL_TONES = {
  neutral: "bg-sidebar-control-surface text-sidebar-foreground",
  warning: "bg-warning/12 text-warning",
} as const;

interface PillAction {
  readonly label: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

/**
 * A notice above the footer's utility row, in the provider update pill's look: an icon
 * and short text, with an optional action on the right. A description shows in a tooltip
 * that focus also opens, and describes the label and the action to screen readers.
 */
function SidebarFooterPill(props: {
  readonly tone: keyof typeof PILL_TONES;
  readonly icon: ReactNode;
  readonly label: string;
  readonly description?: string;
  readonly action?: PillAction;
  readonly exiting?: boolean;
}) {
  const descriptionId = useId();
  const describedBy = props.description ? descriptionId : undefined;
  const labelClassName = "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5";
  const content = (
    <>
      {props.icon}
      <span className="min-w-0 truncate">{props.label}</span>
    </>
  );
  return (
    <div
      data-sidebar-footer-notice=""
      aria-hidden={props.exiting || undefined}
      inert={props.exiting}
      className={cn(
        "relative flex min-h-7 w-full shrink-0 items-center overflow-hidden rounded-lg text-2xs leading-4 pointer-coarse:min-h-9 font-medium transform-gpu transition-all duration-180 ease-drawer will-change-transform starting:translate-y-1.5 starting:opacity-0",
        PILL_TONES[props.tone],
        props.exiting
          ? "pointer-events-none translate-y-1.5 opacity-0"
          : "translate-y-0 opacity-100",
      )}
    >
      {props.description ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  // Focusable so keyboard users can open the tooltip.
                  tabIndex={0}
                  aria-describedby={describedBy}
                  className={cn(
                    labelClassName,
                    "rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                >
                  {content}
                </span>
              }
            />
            <TooltipPopup side="top">{props.description}</TooltipPopup>
          </Tooltip>
          <span id={descriptionId} className="sr-only">
            {props.description}
          </span>
        </>
      ) : (
        <span className={labelClassName}>{content}</span>
      )}
      {props.action ? (
        <button
          type="button"
          disabled={props.action.disabled}
          aria-describedby={describedBy}
          onClick={props.action.onClick}
          className="mr-1 flex h-5 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 outline-none pointer-coarse:h-7 pointer-coarse:px-2.5 hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
        >
          {props.action.label}
        </button>
      ) : null}
    </div>
  );
}

/** The thread undo notice: what just happened, and Undo with its shortcut. */
function SidebarUndoNoticePill() {
  const view = useThreadUndoNoticeView();
  if (!view) return null;
  const Icon = view.icon;
  return (
    <>
      <SidebarFooterPill
        tone="neutral"
        exiting={view.exiting}
        icon={<Icon className="size-3.5 shrink-0" />}
        label={view.label}
        action={{
          label: (
            <>
              Undo
              {view.shortcut ? (
                // A touch screen has no key to press.
                <span className="flex pointer-coarse:hidden">
                  <Kbd>{view.shortcut}</Kbd>
                </span>
              ) : null}
            </>
          ),
          onClick: undoLatestThreadAction,
        }}
      />
      <SidebarCompactUndoNotice
        label={view.label}
        shortcut={view.shortcut}
        exiting={view.exiting}
        onUndo={undoLatestThreadAction}
      />
    </>
  );
}

/** The desktop app's warning that an Intel build runs on Apple Silicon. */
function SidebarArchitecturePill() {
  const state = useDesktopUpdateState();
  const [pending, setPending] = useState(false);
  if (!state || !shouldShowArm64IntelBuildWarning(state)) return null;

  const run = (task: (bridge: DesktopBridge) => Promise<unknown>) => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    setPending(true);
    void task(bridge).finally(() => setPending(false));
  };
  const updateAction = resolveDesktopUpdateButtonAction(state);
  const action: PillAction | null =
    updateAction === "download"
      ? {
          label: "Download",
          disabled: pending,
          onClick: () => run((bridge) => downloadLocalUpdate(bridge, { notifyDownloaded: true })),
        }
      : updateAction === "install"
        ? {
            label: "Restart",
            disabled: pending,
            onClick: () => run((bridge) => confirmAndInstallLocalUpdate(bridge, state)),
          }
        : null;

  return (
    <SidebarFooterPill
      tone="warning"
      icon={<TriangleAlertIcon className="size-3.5 shrink-0" />}
      label="Intel build on Apple Silicon"
      description={getArm64IntelBuildWarningDescription(state)}
      {...(action ? { action } : {})}
    />
  );
}

/** Notices with text that sit above the footer's utility row, below the provider update pill. */
export function SidebarFooterNotices() {
  return (
    <>
      {isElectron ? <SidebarArchitecturePill /> : null}
      <SidebarUndoNoticePill />
    </>
  );
}
