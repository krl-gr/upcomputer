import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@upcomputer/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel turn" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve once" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const renderOption = (option: ProviderApprovalOption) => (
    <Button
      key={option.decision}
      size="sm"
      variant={
        option.decision === "decline"
          ? "destructive-outline"
          : option.decision === "accept"
            ? "default"
            : "outline"
      }
      className={`h-9 rounded-full before:rounded-full sm:h-8 ${
        option.decision === "accept"
          ? "px-5"
          : option.decision === "decline"
            ? "px-4"
            : "px-4 text-muted-foreground"
      }`}
      disabled={isResponding}
      onClick={() => void onRespondToApproval(requestId, option.decision)}
    >
      <span className="max-w-40 truncate">{option.label}</span>
    </Button>
  );
  const isRejection = (option: ProviderApprovalOption) =>
    option.decision === "cancel" || option.decision === "decline";

  return (
    <div
      className="flex w-full min-w-0 flex-wrap items-center gap-2"
      data-composer-approval-actions="true"
    >
      <div className="flex flex-wrap items-center gap-2">
        {options.filter(isRejection).map(renderOption)}
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {options.filter((option) => !isRejection(option)).map(renderOption)}
      </div>
    </div>
  );
});
