import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  registerToolCallHintsResolver,
  type ToolCallHint,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/index.ts";
import { TASK_TOOL_SPECS } from "./TaskToolDefinitions.ts";

/** An argument to show; `{ name: [...] }` shows an array argument's item fields. */
type HintField = string | { readonly [name: string]: ReadonlyArray<string> };

/**
 * The task tools a chat uses to queue work, with the arguments its hint shows.
 * Fewer than the tools take, to keep every chat's prompt short.
 */
const CHAT_TOOLS: ReadonlyArray<readonly [string, ReadonlyArray<HintField>]> = [
  ["task_context", ["projectId", "workspaceRoot", "include"]],
  [
    "task_create",
    [
      "projectId",
      "workspaceRoot",
      { tasks: ["title", "description", "status", "audience", "tags", "metadata"] },
    ],
  ],
  ["task_search", ["projectId", "status", "tags", "limit"]],
  ["task_get", ["id"]],
  ["task_update", ["id", "status", "output", "tags"]],
];

interface ObjectSchema {
  readonly properties?: Readonly<Record<string, { readonly items?: ObjectSchema }>>;
  readonly required?: ReadonlyArray<string>;
}

/**
 * `{a, b?, list?: [{c, d?}]}` from the tool's input schema: an argument the
 * schema does not have is left out and `?` marks the optional ones, so the
 * hint cannot name an argument the tool does not take.
 */
function argsShape(schema: ObjectSchema, fields: ReadonlyArray<HintField>): string {
  const shown = fields.flatMap((field) => {
    const [name, items] =
      typeof field === "string" ? [field, undefined] : Object.entries(field)[0]!;
    const property = schema.properties?.[name];
    if (property === undefined) return [];
    const label = `${name}${schema.required?.includes(name) ? "" : "?"}`;
    return [
      items === undefined || property.items === undefined
        ? label
        : `${label}: [${argsShape(property.items, items)}]`,
    ];
  });
  return `{${shown.join(", ")}}`;
}

/** The chat's hints, from the tool definitions themselves. */
export const CHAT_TOOL_CALL_HINTS: ReadonlyArray<ToolCallHint> = CHAT_TOOLS.flatMap(
  ([name, fields]) => {
    const spec = TASK_TOOL_SPECS.find((candidate) => candidate.name === name);
    return spec === undefined
      ? []
      : [{ name, args: argsShape(spec.inputSchema as ObjectSchema, fields) }];
  },
);

/** Chats get the hints; a task-agent run's thread does not, since its runs gain little from it. */
export const taskChatToolHints = (repository: TaskRepositoryShape, threadId: ThreadId) =>
  repository
    .findLatestAgentRunByThreadId({ threadId })
    .pipe(Effect.map((run) => (Option.isNone(run) ? CHAT_TOOL_CALL_HINTS : [])));

export const TaskChatToolHintsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const repository = yield* TaskRepository;
    yield* registerToolCallHintsResolver((threadId) =>
      taskChatToolHints(repository, threadId).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not tell whether the thread is a chat; no tool hints.", {
            threadId,
            cause,
          }).pipe(Effect.as([])),
        ),
      ),
    );
  }),
);
