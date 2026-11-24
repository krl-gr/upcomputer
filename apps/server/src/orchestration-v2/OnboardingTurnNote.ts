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
 * their first message is not a person opening a conversation. Neither does a
 * thread imported from the user's own CLI history: it is not their first
 * conversation, and Claude Code stores hook context in that CLI session.
 * Removing the block stops it.
 */
export function onboardingTurnNote<E, R>(input: {
  readonly instructions: string | undefined;
  readonly thread: Pick<OrchestrationV2AppThread, "lineage" | "historyOrigin">;
  readonly run: Pick<OrchestrationV2Run, "ordinal" | "providerInstanceId" | "modelSelection">;
  readonly runs: ReadonlyArray<
    Pick<OrchestrationV2Run, "ordinal" | "providerInstanceId" | "modelSelection">
  >;
  readonly message: Pick<
    OrchestrationV2ConversationMessage,
    "createdBy" | "creationSource" | "scheduledTaskId" | "senderThreadId"
  >;
  readonly isCommand: boolean;
  /** Whether the free agent is the only working agent. */
  readonly freeAgentSetupActive: boolean;
  readonly isFreeAgentRun: (
    run: Pick<OrchestrationV2Run, "providerInstanceId" | "modelSelection">,
  ) => boolean;
  /**
   * Read only for a person's first message while the block is pending. Messages
   * to the free agent do not count.
   */
  readonly personMessagedElsewhere: Effect.Effect<boolean, E, R>;
}): Effect.Effect<string, E, R> {
  const { message } = input;
  // The offer waits for the first chat with a real agent; free-agent turns don't make it a
  // later one. A free-agent turn counts every earlier turn, so a setup chat never offers.
  const freeAgentRun = input.isFreeAgentRun(input.run);
  const earlierCounts = (run: Pick<OrchestrationV2Run, "providerInstanceId" | "modelSelection">) =>
    freeAgentRun || !input.isFreeAgentRun(run);
  const due =
    !(freeAgentRun && input.freeAgentSetupActive) &&
    hasPendingOnboarding(input.instructions ?? "") &&
    message.createdBy === "user" &&
    (message.creationSource === "web" || message.creationSource === "mobile") &&
    message.scheduledTaskId === undefined &&
    message.senderThreadId === undefined &&
    input.thread.lineage.parentThreadId === null &&
    input.thread.historyOrigin !== "v1_import" &&
    !input.isCommand &&
    !input.runs.some((run) => run.ordinal < input.run.ordinal && earlierCounts(run));
  if (!due) return Effect.succeed("");
  return input.personMessagedElsewhere.pipe(
    Effect.map((elsewhere) =>
      elsewhere
        ? "[UpComputer onboarding note: this is not the user's first conversation. Do not make the onboarding offer; just answer the message.]"
        : "[UpComputer onboarding note: this is the user's first conversation. Make the one-time onboarding offer from your instructions in this reply.]",
    ),
  );
}
