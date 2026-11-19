import { useAtomValue } from "@effect/atom-react";
import { AlarmClockIcon, ArchiveIcon, CircleCheckIcon, PinOffIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";

// Matches the notices' `duration-180` class.
const NOTICE_EXIT_MS = 180;

const UNDO_ICONS = {
  Archived: ArchiveIcon,
  Snoozed: AlarmClockIcon,
  Settled: CircleCheckIcon,
  Unpinned: PinOffIcon,
  Discarded: Trash2Icon,
} as const;

/**
 * What a thread undo notice shows, wherever it is drawn: the sidebar's pill, the compact
 * column, the phone page. Keeps the last notice while it fades out, then returns null.
 */
export function useThreadUndoNoticeView() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const current = notice ? { action: notice.action, count: notice.count } : null;

  const [shown, setShown] = useState(current);
  if (current && (current.action !== shown?.action || current.count !== shown.count)) {
    setShown(current);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- unmounts after the exit fade on a timer, since a hidden or cancelled fade fires no transitionend
  useEffect(() => {
    if (current || !shown) return;
    const timeoutId = window.setTimeout(() => setShown(null), NOTICE_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [current, shown]);

  const visible = current ?? shown;
  if (!visible) return null;
  return {
    icon: UNDO_ICONS[visible.action],
    /** "Archived", or "Archived 2". */
    label: visible.count === 1 ? visible.action : `${visible.action} ${visible.count}`,
    /** "⌘Z", or null when the command has no key. */
    shortcut: shortcutLabelForCommand(keybindings, "thread.undo"),
    exiting: !current,
  };
}
