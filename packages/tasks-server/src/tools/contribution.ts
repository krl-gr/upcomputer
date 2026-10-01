import {
  experimentalDynamicToolOwnerLayer,
  type ExperimentalDynamicToolOwner,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskToolService, type TaskToolServiceShape } from "./TaskToolServiceTag.ts";
import { TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export function makeTaskDynamicToolOwner(
  service: TaskToolServiceShape,
): ExperimentalDynamicToolOwner<never, never> {
  return {
    ownerId: "upcomputer.tasks",
    version: 1,
    tools: TASK_TOOL_SPECS.map((spec) => ({
      spec,
      execute: (args, context) => service.call({ name: spec.name, args, context }),
    })),
  };
}

/** Captures the feature service before registering fully closed handlers. */
export const TaskDynamicToolRegistrationLive = Layer.unwrap(
  Effect.map(TaskToolService, (service) =>
    experimentalDynamicToolOwnerLayer(makeTaskDynamicToolOwner(service)),
  ),
);
