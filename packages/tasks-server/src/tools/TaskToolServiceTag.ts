import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { TaskToolCallResult, TaskToolInvocationContext } from "./TaskToolTypes.ts";

export interface TaskToolServiceShape {
  readonly call: (input: {
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly context: TaskToolInvocationContext;
  }) => Effect.Effect<TaskToolCallResult>;
}

export class TaskToolService extends Context.Service<TaskToolService, TaskToolServiceShape>()(
  "@t3tools/tasks-server/tools/TaskToolService",
) {}
