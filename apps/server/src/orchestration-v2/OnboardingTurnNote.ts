import {
  hasPendingOnboarding,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * Hidden note for the first prompt a person sends in a new conversation while
 * the All chats instructions still hold the onboarding block. Small models skip
 * the block's one-time offer on a bare greeting, and repeat it in every new chat
 * while the block waits for an answer; a short note next to the user's message
 * is the instruction they follow. So the note asks for the offer in the user's
 * first conversation and forbids it in later ones: a person who already wrote
 * in another thread was offered there, answered or not. Task-agent runs,
 * scheduled tasks and threads another agent or thread started do not get it:
 * their first message is not a person opening a conversation. Removing the
 * block stops it.
 */
export function onboardingTurnNote<E, R>(input: {
  readonly instructions: string | undefined;
  readonly thread: Pick<OrchestrationV2AppThread, "lineage">;
  readonly run: Pick<OrchestrationV2Run, "ordinal">;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "ordinal">>;
  readonly message: Pick<
    OrchestrationV2ConversationMessage,
    "createdBy" | "creationSource" | "scheduledTaskId" | "senderThreadId"
  >;
  readonly isCommand: boolean;
  /** Read only for a person's first message while the block is pending. */
  readonly personMessagedElsewhere: Effect.Effect<boolean, E, R>;
}): Effect.Effect<string, E, R> {
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
  if (!due) return Effect.succeed("");
  return input.personMessagedElsewhere.pipe(
    Effect.map((elsewhere) =>
      elsewhere
        ? "[UpComputer onboarding note: this is not the user's first conversation. Do not make the onboarding offer; just answer the message.]"
        : "[UpComputer onboarding note: this is the user's first conversation. Make the one-time onboarding offer from your instructions in this reply.]",
    ),
  );
}
