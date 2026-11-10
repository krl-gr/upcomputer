import { useAtomValue } from "@effect/atom-react";
import {
  AlarmClockIcon,
  ArchiveIcon,
  CircleCheckIcon,
  PinOffIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { isElectron } from "../../env";
import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  getArm64IntelBuildWarningDescription,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
} from "../desktopUpdate.logic";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { downloadLocalUpdate, installLocalUpdate } from "./SidebarUpdatePill";

// Matches the pill's `duration-180` class, like the provider update pill above it.
const PILL_EXIT_MS = 180;

const PILL_TONES = {
  neutral: "bg-sidebar-control-surface text-sidebar-foreground",
  warning: "bg-warning/12 text-warning",
} as const;

/**
 * A notice above the footer's utility row, in the provider update pill's look: an icon
 * and short text, with an optional action on the right.
 */
function SidebarFooterPill(props: {
  readonly tone: keyof typeof PILL_TONES;
  readonly icon: ReactNode;
  readonly label: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly exiting?: boolean;
}) {
  const label = (
    <span className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
      {props.icon}
      <span className="min-w-0 truncate">{props.label}</span>
    </span>
  );
  return (
    <div
      data-sidebar-footer-notice=""
      aria-hidden={props.exiting || undefined}
      inert={props.exiting}
      className={cn(
        "relative flex min-h-7 w-full shrink-0 items-center overflow-hidden rounded-lg text-2xs leading-4 font-medium transform-gpu transition-all duration-180 ease-drawer will-change-transform starting:translate-y-1.5 starting:opacity-0",
        PILL_TONES[props.tone],
        props.exiting
          ? "pointer-events-none translate-y-1.5 opacity-0"
          : "translate-y-0 opacity-100",
      )}
    >
      {props.description ? (
        <Tooltip>
          <TooltipTrigger render={label} />
          <TooltipPopup side="top">{props.description}</TooltipPopup>
        </Tooltip>
      ) : (
        label
      )}
      {props.action}
    </div>
  );
}

function PillAction(props: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="mr-1 flex h-5 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
    >
      {props.children}
    </button>
  );
}

const UNDO_ICONS = {
  Archived: ArchiveIcon,
  Snoozed: AlarmClockIcon,
  Settled: CircleCheckIcon,
  Unpinned: PinOffIcon,
  Discarded: Trash2Icon,
} as const;

/** The thread undo notice: what just happened, and Undo with its shortcut. */
function SidebarUndoNoticePill() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const current = notice ? { action: notice.action, count: notice.count } : null;

  // Keeps the last notice on screen while it fades out, then unmounts on a timer.
  const [shown, setShown] = useState(current);
  if (current && (current.action !== shown?.action || current.count !== shown.count)) {
    setShown(current);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- unmounts after the exit fade on a timer, since a hidden or cancelled fade fires no transitionend
  useEffect(() => {
    if (current || !shown) return;
    const timeoutId = window.setTimeout(() => setShown(null), PILL_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [current, shown]);

  const visible = current ?? shown;
  if (!visible) return null;
  const Icon = UNDO_ICONS[visible.action];
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");
  return (
    <SidebarFooterPill
      tone="neutral"
      exiting={!current}
      icon={<Icon className="size-3.5 shrink-0" />}
      label={visible.count === 1 ? visible.action : `${visible.action} ${visible.count}`}
      action={
        <PillAction onClick={undoLatestThreadAction}>
          Undo
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </PillAction>
      }
    />
  );
}

/** The desktop app's warning that an Intel build runs on Apple Silicon. */
function SidebarArchitecturePill() {
  const state = useDesktopUpdateState();
  const [pending, setPending] = useState(false);
  if (!state || !shouldShowArm64IntelBuildWarning(state)) return null;

  const bridge = window.desktopBridge;
  const updateAction = resolveDesktopUpdateButtonAction(state);
  const run = (task: Promise<unknown>) => {
    setPending(true);
    void task.finally(() => setPending(false));
  };
  const action =
    bridge && updateAction === "download" ? (
      <PillAction
        disabled={pending}
        onClick={() => run(downloadLocalUpdate(bridge, { notifyDownloaded: true }))}
      >
        Download
      </PillAction>
    ) : bridge && updateAction === "install" ? (
      <PillAction disabled={pending} onClick={() => run(installLocalUpdate(bridge))}>
        Restart
      </PillAction>
    ) : undefined;

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
