import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/**
 * Where the "all chats" instructions live. On the V1 fork this was the core
 * `customInstructions` server setting; upstream v2 has no such setting yet, so
 * the host provides the storage (and injects the text into provider prompts).
 */
export interface AllChatsInstructionsShape {
  readonly get: Effect.Effect<string, AllChatsInstructionsError>;
  readonly set: (text: string) => Effect.Effect<void, AllChatsInstructionsError>;
}

export interface AllChatsInstructionsError {
  readonly _tag: "AllChatsInstructionsError";
  readonly message: string;
}

export class AllChatsInstructions extends Context.Service<
  AllChatsInstructions,
  AllChatsInstructionsShape
>()("@t3tools/tasks-server/persistence/AllChatsInstructions") {}
