import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

interface ThreadViewersShape {
  readonly track: <A, E, R>(
    threadId: string,
    stream: Stream.Stream<A, E, R>,
  ) => Stream.Stream<A, E, R>;
  readonly isWatched: (threadId: string) => Effect.Effect<boolean>;
}

export const make = (): ThreadViewersShape => {
  const counts = new Map<string, number>();
  const release = (threadId: string) => {
    const next = (counts.get(threadId) ?? 1) - 1;
    if (next <= 0) counts.delete(threadId);
    else counts.set(threadId, next);
  };
  return {
    track: (threadId, stream) =>
      Stream.suspend(() => {
        counts.set(threadId, (counts.get(threadId) ?? 0) + 1);
        return stream.pipe(Stream.ensuring(Effect.sync(() => release(threadId))));
      }),
    isWatched: (threadId) => Effect.sync(() => (counts.get(threadId) ?? 0) > 0),
  };
};

/**
 * Counts the client subscriptions following each thread, so work that needs the user's
 * eyes on a thread (such as a sign-in terminal) can tell whether any window shows it.
 * One per process: the WebSocket handlers and /mcp tools must share it.
 */
export class ThreadViewers extends Context.Reference<ThreadViewersShape>(
  "t3/orchestration-v2/ThreadViewers",
  { defaultValue: make },
) {}
