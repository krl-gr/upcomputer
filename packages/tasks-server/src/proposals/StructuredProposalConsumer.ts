import {
  OrchestrationProposalSpec,
  type OrchestrationProposalSpec as OrchestrationProposalSpecType,
  type OrchestrationProposedPlanId,
} from "@upcomputer/tasks-contracts/v1";
import { parseOrchestrationProposalMarkdown } from "@upcomputer/orchestrator/parser";
import type { ThreadId } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ExperimentalProviderRuntimeEvents,
  ProjectionSnapshotQuery,
} from "../../../../apps/server/src/extensionApi.ts";
import { retryOperational } from "../retryOperational.ts";
import { ProposalStore } from "./ProposalStore.ts";

const decodeProposal = Schema.decodeUnknownEffect(OrchestrationProposalSpec);

function planIdForEvent(input: {
  readonly threadId: string;
  readonly turnId?: string | undefined;
}): OrchestrationProposedPlanId {
  return input.turnId
    ? `plan:${input.threadId}:turn:${input.turnId}`
    : `plan:${input.threadId}:unbound`;
}

function planIdForMessage(input: {
  readonly threadId: string;
  readonly turnId: string | null;
}): OrchestrationProposedPlanId {
  return input.turnId
    ? `plan:${input.threadId}:turn:${input.turnId}`
    : `plan:${input.threadId}:unbound`;
}

export const StructuredProposalConsumerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const runtimeEvents = yield* ExperimentalProviderRuntimeEvents;
    const projections = yield* ProjectionSnapshotQuery;
    const store = yield* ProposalStore;

    const persistProposal = (input: {
      readonly threadId: ThreadId;
      readonly planId: OrchestrationProposedPlanId;
      readonly proposal: OrchestrationProposalSpecType;
      readonly createdAt: string;
    }) =>
      store.upsertOutput({
        threadId: input.threadId,
        planId: input.planId,
        ownerId: "upcomputer.orchestrator",
        modeId: "orchestrator",
        modeVersion: 1,
        proposal: input.proposal,
        createdAt: input.createdAt,
      });

    // Reads thread shells, then only the Orchestrator threads' messages. A full
    // snapshot would hydrate every thread's messages and activities at startup,
    // which exhausts the heap on large histories.
    const recoverPersistedProposals = Effect.gen(function* () {
      const [active, archived] = yield* Effect.all([
        projections.getShellSnapshot(),
        projections.getArchivedShellSnapshot(),
      ]);
      const threadIds = new Set(
        [...active.threads, ...archived.threads]
          .filter((thread) => thread.interactionMode === "orchestrator")
          .map((thread) => thread.id),
      );
      yield* Effect.forEach(
        threadIds,
        (threadId) =>
          projections.getThreadDetailById(threadId, { activityKinds: [] }).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (thread) =>
                  Effect.forEach(
                    thread.messages.filter(
                      (message) =>
                        message.role === "assistant" &&
                        !message.streaming &&
                        Boolean(message.text.trim()),
                    ),
                    (message) => {
                      const proposal = parseOrchestrationProposalMarkdown(message.text);
                      if (!proposal) return Effect.void;
                      return persistProposal({
                        threadId: thread.id,
                        planId: planIdForMessage({
                          threadId: thread.id,
                          turnId: message.turnId,
                        }),
                        proposal,
                        createdAt: message.updatedAt,
                      }).pipe(Effect.asVoid);
                    },
                    { discard: true, concurrency: 1 },
                  ),
              }),
            ),
          ),
        { discard: true, concurrency: 4 },
      );
    });

    yield* runtimeEvents.stream.pipe(
      Stream.runForEach((event) => {
        if (event.type !== "turn.interaction-mode-output.completed") return Effect.void;
        if (
          event.payload.ownerId !== "upcomputer.orchestrator" ||
          event.payload.modeId !== "orchestrator" ||
          event.payload.modeVersion !== 1 ||
          event.payload.outputKind !== "structured"
        ) {
          return Effect.void;
        }

        return decodeProposal(event.payload.output).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.logWarning("Ignored invalid Orchestrator output", {
                threadId: event.threadId,
                eventId: event.eventId,
                error,
              }),
            onSuccess: (proposal) =>
              retryOperational(
                persistProposal({
                  threadId: event.threadId,
                  planId: planIdForEvent(event),
                  proposal,
                  createdAt: event.createdAt,
                }),
                {
                  operation: "persist-orchestrator-proposal",
                  threadId: event.threadId,
                  eventId: event.eventId,
                },
              ).pipe(
                Effect.tap((stored) =>
                  Effect.logInfo("Persisted Orchestrator proposal", {
                    threadId: stored.threadId,
                    planId: stored.planId,
                  }),
                ),
                Effect.asVoid,
              ),
          }),
        );
      }),
      (streamEffect) =>
        retryOperational(streamEffect, {
          operation: "orchestrator-output-stream",
        }),
      Effect.forkScoped,
    );
    yield* retryOperational(recoverPersistedProposals, {
      operation: "recover-persisted-orchestrator-proposals",
    }).pipe(Effect.forkScoped);
  }),
);
