import {
  hasPendingOnboarding,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";

/**
 * Hidden note for the first prompt a person sends in a new conversation while
 * the All chats instructions still hold the onboarding block. Small models skip
 * the block's one-time offer on a bare greeting; a short note next to the user's
 * message is the instruction they follow. Task-agent runs, scheduled tasks and
 * threads another agent or thread started do not get it: their first message
 * is not a person opening a conversation. Removing the block stops it.
 */
export function onboardingTurnNote(input: {
  readonly instructions: string | undefined;
  readonly thread: Pick<OrchestrationV2AppThread, "lineage">;
  readonly run: Pick<OrchestrationV2Run, "ordinal">;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "ordinal">>;
  readonly message: Pick<
    OrchestrationV2ConversationMessage,
    "createdBy" | "creationSource" | "scheduledTaskId" | "senderThreadId"
  >;
  readonly isCommand: boolean;
}): string {
  const { message } = input;
  const due =
    hasPendingOnboarding(input.instructions ?? "") &&
    message.createdBy === "user" &&
    (message.creationSource === "web" || message.creationSource === "mobile") &&
    message.scheduledTaskId === undefined &&
    message.senderThreadId === undefined &&
    input.thread.lineage.parentThreadId === null &&
    !input.isCommand &&
    !input.runs.some((run) => run.ordinal < input.run.ordinal);
  if (!due) return "";
  return "[UpComputer: this is the first message of this conversation, and the one-time onboarding in your instructions is still pending. Follow it in this reply.]";
}
