import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  BOTS_RPC_METHODS as M,
  BOTS_RPC_NAMESPACE,
  BotsRpcGroup,
  TaskError,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  defineNamespacedRpcContribution,
  forkParked,
  registerTurnContextResolver,
} from "../../../../apps/server/src/extensionApi.ts";
import { retryOperational } from "../retryOperational.ts";
import { BotService } from "./BotService.ts";

export const BotContextLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const bots = yield* BotService;
    yield* registerTurnContextResolver(bots.context);
    yield* forkParked(
      bots.recover.pipe(
        Effect.catch((cause) => Effect.logError("Bot chat recovery failed", { cause })),
        Effect.andThen(retryOperational(bots.followChatRenames, { operation: "bot-chat-renames" })),
      ),
    );
  }),
);

export const BOTS_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "bots-rpc-v1",
  ownerId: "upcomputer.tasks",
  version: 1,
  namespace: BOTS_RPC_NAMESPACE,
  group: BotsRpcGroup,
  requiredScopes: {
    [M.list]: AuthOrchestrationReadScope,
    [M.memory]: AuthOrchestrationReadScope,
    [M.save]: AuthOrchestrationOperateScope,
    [M.remove]: AuthOrchestrationOperateScope,
    [M.remember]: AuthOrchestrationOperateScope,
    [M.forget]: AuthOrchestrationOperateScope,
    [M.proposals]: AuthOrchestrationReadScope,
    [M.acceptProposal]: AuthOrchestrationOperateScope,
    [M.rejectProposal]: AuthOrchestrationOperateScope,
    [M.assign]: AuthOrchestrationOperateScope,
    [M.extract]: AuthOrchestrationOperateScope,
  },
  handlers: () =>
    BotsRpcGroup.toLayer(
      BotsRpcGroup.of({
        [M.list]: () => Effect.flatMap(BotService, (bots) => bots.list),
        [M.save]: (input) => Effect.flatMap(BotService, (bots) => bots.save(input)),
        [M.remove]: (input) => Effect.flatMap(BotService, (bots) => bots.remove(input.agentId)),
        [M.memory]: (input) => Effect.flatMap(BotService, (bots) => bots.memory(input.agentId)),
        [M.remember]: (input) =>
          Effect.flatMap(BotService, (bots) =>
            bots
              .remember(input, "user")
              .pipe(
                Effect.flatMap((entry) =>
                  entry === null
                    ? Effect.fail(
                        new TaskError({ message: "This entry was deleted. Create a new memory." }),
                      )
                    : Effect.succeed(entry),
                ),
              ),
          ),
        [M.forget]: (input) =>
          Effect.flatMap(BotService, (bots) => bots.forget(input.agentId, input.id, "user")),
        [M.proposals]: (input) =>
          Effect.flatMap(BotService, (bots) => bots.proposals(input.agentId)),
        [M.acceptProposal]: (input) =>
          Effect.flatMap(BotService, (bots) => bots.acceptProposal(input.agentId, input.id)),
        [M.rejectProposal]: (input) =>
          Effect.flatMap(BotService, (bots) => bots.rejectProposal(input.agentId, input.id)),
        [M.assign]: (input) => Effect.flatMap(BotService, (bots) => bots.assign(input)),
        [M.extract]: (input) =>
          Effect.flatMap(BotService, (bots) => bots.extract(input.agentId, input.requestId)),
      }),
    ),
});
