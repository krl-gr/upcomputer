import type { MessageId, ProjectId, ProviderInteractionMode, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export interface TurnContextInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly interactionMode?: ProviderInteractionMode;
}
export interface TurnContext {
  readonly text: string;
}
type Resolver = (input: TurnContextInput) => Effect.Effect<TurnContext, unknown>;
let resolver: Resolver | undefined;

export const registerTurnContextResolver = (value: Resolver) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      resolver = value;
    }),
    () =>
      Effect.sync(() => {
        if (resolver === value) resolver = undefined;
      }),
  );

// Unlike optional tool hints, a failed context/access read must stop the turn.
export const turnContextFor = (input: TurnContextInput): Effect.Effect<TurnContext, unknown> =>
  resolver === undefined ? Effect.succeed({ text: "" }) : resolver(input);
