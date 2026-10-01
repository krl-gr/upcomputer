import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  ExperimentalDynamicToolCallResult,
  ExperimentalDynamicToolInvocationContext,
} from "../../../../apps/server/src/extensionApi.ts";

export interface TaskToolServiceShape {
  readonly call: (input: {
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly context: ExperimentalDynamicToolInvocationContext;
  }) => Effect.Effect<ExperimentalDynamicToolCallResult>;
}

export class TaskToolService extends Context.Service<TaskToolService, TaskToolServiceShape>()(
  "@upcomputer/tasks-server/tools/TaskToolService",
) {}
