import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { WorkflowIcon } from "lucide-react";

import { InlineButton } from "../../../../apps/web/src/components/ui/button.tsx";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import {
  NotificationButton,
  NotificationCard,
} from "../../../../apps/web/src/sidebarNotifications/NotificationCard.tsx";
import { DiscussUpdatesButton } from "./DiscussUpdatesButton.tsx";
import { INSTRUCTION_UPDATES_ID, instructionUpdateRowId } from "./InstructionUpdatesSection.tsx";
import { dismissInstructionUpdatesNotice, useInstructionUpdates } from "./workflowUpdates.ts";

/** How many updates the bell shows a card for: none once dismissed or decided. */
export function useInstructionUpdatesNoticeCount(): number {
  const { pending, noticeShown } = useInstructionUpdates();
  return noticeShown ? pending.length : 0;
}

/**
 * The bell's card for a release's instruction updates: one card however many there are.
 * Dismissing it leaves the updates in Settings → Instructions.
 */
export function InstructionUpdatesNotification({ onClose }: { readonly onClose: () => void }) {
  const gt = useGT();
  const navigate = useNavigate();
  const { pending, noticeShown } = useInstructionUpdates();
  const first = pending[0];
  if (!noticeShown || !first) return null;
  const single = pending.length === 1;
  const openSettings = () => {
    onClose();
    void navigate({
      href: `/settings/instructions#${single ? instructionUpdateRowId(first.id) : INSTRUCTION_UPDATES_ID}`,
    });
  };
  return (
    <NotificationCard
      tone="info"
      icon={<WorkflowIcon />}
      title={single ? first.title : gt("{count} instruction updates", { count: pending.length })}
      detail={
        single
          ? gt("{summary} Nothing changes until you decide.", { summary: first.summary })
          : gt("Up.computer {release} changed its defaults. Nothing changes until you decide.", {
              release: first.release,
            })
      }
      below={
        single ? null : (
          <ul className="space-y-1 text-xs leading-4 text-foreground/85">
            {pending.map((entry) => (
              <li key={entry.id} className="flex gap-1.5">
                <span aria-hidden className="text-muted-foreground">
                  •
                </span>
                {entry.title}
              </li>
            ))}
          </ul>
        )
      }
      links={
        <>
          <DiscussUpdatesButton
            entries={pending}
            render={<NotificationButton tone="primary" />}
            onOpened={onClose}
          />
          <InlineButton tone="muted" onClick={openSettings}>
            {gt("What changed")}
          </InlineButton>
        </>
      }
      onDismiss={() => {
        dismissInstructionUpdatesNotice();
        toastManager.add({
          type: "info",
          title: gt("Saved for later"),
          description: gt("Find it in Settings, under Instructions."),
          actionProps: { children: gt("Open"), onClick: openSettings },
        });
      }}
    />
  );
}
