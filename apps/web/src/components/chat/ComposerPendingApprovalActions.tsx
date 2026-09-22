import { type ApprovalRequestId, type ProviderApprovalDecision } from "@upcomputer/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  return (
    <div
      className="flex w-full min-w-0 flex-wrap items-center gap-2"
      data-composer-approval-actions="true"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-9 rounded-full px-4 text-muted-foreground before:rounded-full sm:h-8"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "cancel")}
        >
          Cancel turn
        </Button>
        <Button
          size="sm"
          variant="destructive-outline"
          className="h-9 rounded-full px-4 before:rounded-full sm:h-8"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "decline")}
        >
          Decline
        </Button>
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-9 rounded-full px-4 text-muted-foreground before:rounded-full sm:h-8"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
        >
          Always allow this session
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-9 rounded-full px-5 before:rounded-full sm:h-8"
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, "accept")}
        >
          Approve once
        </Button>
      </div>
    </div>
  );
});
