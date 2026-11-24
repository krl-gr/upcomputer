import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { WorkflowIcon } from "lucide-react";

import { InlineButton } from "../../../../apps/web/src/components/ui/button.tsx";
import { toastManager } from "../../../../apps/web/src/components/ui/toast.tsx";
import {
  NotificationButton,
  NotificationCard,
} from "../../../../apps/web/src/sidebarNotifications/NotificationCard.tsx";
import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";
import { DiscussUpdatesButton } from "./DiscussUpdatesButton.tsx";
import { instructionUpdateCopy, instructionUpdatesNoticeDetail } from "./instructionUpdateCopy.ts";
import { INSTRUCTION_UPDATES_ID, instructionUpdateRowId } from "./InstructionUpdatesSection.tsx";
import { updateInstructionUpdates, useInstructionUpdates } from "./workflowUpdates.ts";

/** How many updates the bell's card holds: none once they are dismissed or decided. */
export function useInstructionUpdatesNoticeCount(): number {
  return useInstructionUpdates(usePrimaryEnvironmentId()).notice.length;
}

/**
 * The bell's card for the install's instruction updates: one card however many
 * there are. Dismissing it leaves them waiting in Settings → Instructions.
 */
export function InstructionUpdatesNotification({ onClose }: { readonly onClose: () => void }) {
  const gt = useGT();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const updates = useInstructionUpdates(environmentId);
  const { notice } = updates;
  const first = notice[0];
  if (environmentId === null || !first) return null;
  const single = notice.length === 1;
  const openSettings = () => {
    onClose();
    void navigate({
      href: `/settings/instructions#${single ? instructionUpdateRowId(first.entry.id) : INSTRUCTION_UPDATES_ID}`,
    });
  };
  return (
    <NotificationCard
      tone="info"
      icon={<WorkflowIcon />}
      title={
        single
          ? instructionUpdateCopy(gt, first.entry).title
          : gt("{count} instruction updates", { count: notice.length })
      }
      detail={instructionUpdatesNoticeDetail(gt, updates)}
      below={
        single ? null : (
          <ul className="space-y-1 text-xs leading-4 text-foreground/85">
            {notice.map(({ entry }) => (
              <li key={entry.id} className="flex gap-1.5">
                <span aria-hidden className="text-muted-foreground">
                  •
                </span>
                {instructionUpdateCopy(gt, entry).title}
              </li>
            ))}
          </ul>
        )
      }
      links={
        <>
          <DiscussUpdatesButton
            environmentId={environmentId}
            entries={notice.map(({ entry }) => entry)}
            render={<NotificationButton tone="primary" />}
            onOpened={onClose}
          />
          <InlineButton tone="muted" onClick={openSettings}>
            {gt("What changed")}
          </InlineButton>
        </>
      }
      onDismiss={() => {
        void updateInstructionUpdates(environmentId, {
          entries: notice.map(({ entry }) => ({ id: entry.id, state: "dismissed" })),
        }).catch(() => undefined);
        toastManager.add({
          type: "info",
          title: gt("Saved for later"),
          description: gt("Find it in Settings, under Instructions."),
          actionProps: {
            children: gt("Open", {
              $context: "button that opens the instruction updates in Settings",
            }),
            onClick: openSettings,
          },
        });
      }}
    />
  );
}
