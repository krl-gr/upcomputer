import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  namesOrchestrationTool,
  registerOrchestrationInstructionsResolver,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/index.ts";

/**
 * Whether a thread's agent gets the chat-oriented orchestration block
 * (delegation, thread launch, scheduling). A task-agent run gets it only when
 * its agent's tool list names one of those tools; an agent without a tool
 * list keeps it, and so does every thread that no run used.
 */
export const taskAgentOrchestrationInstructions = (
  repository: TaskRepositoryShape,
  threadId: ThreadId,
) =>
  Effect.gen(function* () {
    const run = yield* repository.findLatestAgentRunByThreadId({ threadId });
    if (Option.isNone(run)) return undefined;
    const agent = yield* repository.getAgentById({ id: run.value.agentId });
    const tools = Option.isSome(agent) ? agent.value.config.tools : undefined;
    return tools === undefined ? undefined : namesOrchestrationTool(tools);
  });

export const TaskAgentOrchestrationInstructionsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    yield* registerOrchestrationInstructionsResolver((threadId) =>
      taskAgentOrchestrationInstructions(repository, threadId).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not read the task agent's tools; keeping orchestration.", {
            threadId,
            cause,
          }).pipe(Effect.as(undefined)),
        ),
      ),
    );
  }),
);
