import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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

/**
 * Until core stores and injects the "all chats" instructions, they read as
 * empty and saving them fails with a clear error instead of being dropped.
 */
export const AllChatsInstructionsUnavailableLive = Layer.succeed(AllChatsInstructions, {
  get: Effect.succeed(""),
  set: () =>
    Effect.fail({
      _tag: "AllChatsInstructionsError",
      message: "All-chats instructions are not available on this server yet.",
    } satisfies AllChatsInstructionsError),
});
