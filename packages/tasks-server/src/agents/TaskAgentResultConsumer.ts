import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  ExperimentalProviderRuntimeEvents,
  ProjectionSnapshotQuery,
} from "../../../../apps/server/src/extensionApi.ts";
import { retryOperational } from "../retryOperational.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskAgentService } from "./TaskAgentService.ts";
import {
  latestFinalizedAssistantMessage,
  makeTaskAgentResultConsumer,
} from "./TaskAgentResultFinalization.ts";

export const TaskAgentResultConsumerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const runtimeEvents = yield* ExperimentalProviderRuntimeEvents;
    const projections = yield* ProjectionSnapshotQuery;
    const repository = yield* TaskRepository;
    const taskAgents = yield* TaskAgentService;

    const consumeEvent = makeTaskAgentResultConsumer({
      repository,
      scheduleTaskChanged: taskAgents.scheduleTaskChanged,
    });

    const recoverPersistedResults = Effect.gen(function* () {
      const activeRuns = yield* repository.listAllActiveAgentRuns();
      yield* Effect.forEach(
        activeRuns,
        (run) =>
          projections.getThreadDetailById(run.threadId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (thread) => {
                  const message = latestFinalizedAssistantMessage(thread.messages);
                  if (!message) return Effect.void;
                  return consumeEvent({
                    threadId: run.threadId,
                    markdown: message.text,
                    createdAt: message.updatedAt,
                  });
                },
              }),
            ),
          ),
        { discard: true, concurrency: 4 },
      );
    });

    yield* runtimeEvents.stream.pipe(
      Stream.runForEach((event) => {
        if (
          event.type !== "item.completed" ||
          event.payload.itemType !== "assistant_message" ||
          !event.payload.detail?.trim()
        )
          return Effect.void;
        return retryOperational(
          consumeEvent({
            threadId: event.threadId,
            markdown: event.payload.detail,
            createdAt: event.createdAt,
          }),
          {
            operation: "consume-task-agent-result",
            eventId: event.eventId,
            threadId: event.threadId,
          },
        );
      }),
      (streamEffect) =>
        retryOperational(streamEffect, {
          operation: "task-agent-result-stream",
        }),
      Effect.forkScoped,
    );

    yield* retryOperational(recoverPersistedResults.pipe(Effect.andThen(taskAgents.recover)), {
      operation: "recover-persisted-task-agent-results",
    }).pipe(Effect.forkScoped);
  }),
);
