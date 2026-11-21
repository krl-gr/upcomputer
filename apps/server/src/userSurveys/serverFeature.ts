import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  USER_SURVEY_RPC_METHODS as M,
  USER_SURVEY_RPC_NAMESPACE,
  UserSurveyRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  defineExperimentalServerFeature,
  defineNamespacedRpcContribution,
  eraseExperimentalServerLayer,
} from "../extensionApi.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as UserSurveys from "./UserSurveys.ts";

const USER_SURVEYS_FEATURE_ID = "upcomputer.user-surveys";

/** The survey built into the release, its RPCs, and feedback sent from the notifications popover. */
export const USER_SURVEYS_SERVER_FEATURE = defineExperimentalServerFeature({
  id: USER_SURVEYS_FEATURE_ID,
  version: 1,
  layers: [
    {
      id: "user-surveys",
      ownerId: USER_SURVEYS_FEATURE_ID,
      version: 1,
      layer: eraseExperimentalServerLayer(
        UserSurveys.layer.pipe(Layer.provide(ManagedPolicy.layer)),
      ),
    },
  ],
  rpc: [
    defineNamespacedRpcContribution({
      id: "user-surveys-rpc-v1",
      ownerId: USER_SURVEYS_FEATURE_ID,
      version: 1,
      namespace: USER_SURVEY_RPC_NAMESPACE,
      group: UserSurveyRpcGroup,
      requiredScopes: {
        [M.current]: AuthOrchestrationReadScope,
        [M.report]: AuthOrchestrationOperateScope,
        [M.feedback]: AuthOrchestrationOperateScope,
      },
      handlers: () =>
        UserSurveyRpcGroup.toLayer(
          UserSurveyRpcGroup.of({
            [M.current]: () =>
              Effect.flatMap(UserSurveys.UserSurveys, (surveys) => surveys.current),
            [M.report]: (input) =>
              Effect.flatMap(UserSurveys.UserSurveys, (surveys) => surveys.report(input)),
            [M.feedback]: (input) =>
              Effect.flatMap(UserSurveys.UserSurveys, (surveys) => surveys.sendFeedback(input)),
          }),
        ),
    }),
  ],
});
