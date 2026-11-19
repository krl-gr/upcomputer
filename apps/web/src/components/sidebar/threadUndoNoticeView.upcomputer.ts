import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react";
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

/** What the undo notice says it did, with the thread count when there are several. */
function undoNoticeLabel(
  action: keyof typeof UNDO_ICONS,
  count: number,
  gt: ReturnType<typeof useGT>,
): string {
  switch (action) {
    case "Archived":
      return gt("{count, plural, =1 {Archived} one {Archived #} other {Archived #}}", { count });
    case "Snoozed":
      return gt("{count, plural, =1 {Snoozed} one {Snoozed #} other {Snoozed #}}", { count });
    case "Settled":
      return gt("{count, plural, =1 {Settled} one {Settled #} other {Settled #}}", { count });
    case "Unpinned":
      return gt("{count, plural, =1 {Unpinned} one {Unpinned #} other {Unpinned #}}", { count });
    case "Discarded":
      return gt("{count, plural, =1 {Discarded} one {Discarded #} other {Discarded #}}", {
        count,
      });
  }
}

/**
 * What a thread undo notice shows, wherever it is drawn: the sidebar's pill, the compact
 * column, the phone page. Keeps the last notice while it fades out, then returns null.
 */
export function useThreadUndoNoticeView() {
  const gt = useGT();
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
    label: undoNoticeLabel(visible.action, visible.count, gt),
    /** "⌘Z", or null when the command has no key. */
    shortcut: shortcutLabelForCommand(keybindings, "thread.undo"),
    exiting: !current,
  };
}
