import type { OrchestrationEvent } from "@upcomputer/contracts";
import { makeDrainableWorker } from "@upcomputer/shared/DrainableWorker";
// `rmdir` removes only an empty directory, which FileSystem cannot express.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../../config.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { scratchWorkspaceRootFor } from "../../project/scratchWorkspace.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadDeletionReactor,
  type ThreadDeletionReactorShape,
} from "../Services/ThreadDeletionReactor.ts";

type ThreadDeletedEvent = Extract<OrchestrationEvent, { type: "thread.deleted" }>;

export const logCleanupCauseUnlessInterrupted = <R, E>({
  effect,
  message,
  threadId,
}: {
  readonly effect: Effect.Effect<void, E, R>;
  readonly message: string;
  readonly threadId: ThreadDeletedEvent["payload"]["threadId"];
}): Effect.Effect<void, E, R> =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.logDebug(message, {
        threadId,
        cause: Cause.pretty(cause),
      });
    }),
  );

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;

  const stopProviderSession = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: providerService.stopSession({ threadId }),
      message: "thread deletion cleanup skipped provider session stop",
      threadId,
    });

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const threadRepository = yield* ProjectionThreadRepository;
  const scratchRoot = scratchWorkspaceRootFor(path, (yield* ServerConfig.ServerConfig).baseDir);

  // A scratch thread's folder is named for it alone, so once the thread is gone
  // an empty folder is litter. Only a direct child of the scratch root is ever
  // touched, only while no other live thread points at it, and only if it is
  // empty; `rmdir` refuses a folder that gained a file after the check.
  const removeEmptyScratchFolder = Effect.fn("removeEmptyScratchFolder")(function* (
    threadId: ThreadDeletedEvent["payload"]["threadId"],
  ) {
    const thread = yield* threadRepository.getById({ threadId });
    // A missing row, or one a later create already reused, is not ours to clean.
    if (Option.isNone(thread) || thread.value.deletedAt === null) return;
    const worktreePath = thread.value.worktreePath;
    if (
      worktreePath === null ||
      !path.isAbsolute(worktreePath) ||
      worktreePath.split(/[\\/]/).includes("..")
    ) {
      return;
    }
    const folder = path.resolve(worktreePath);
    if (path.dirname(folder) !== scratchRoot) return;
    const siblings = yield* threadRepository.listByProjectId({
      projectId: thread.value.projectId,
    });
    if (
      siblings.some(
        (sibling) =>
          sibling.threadId !== threadId &&
          sibling.deletedAt === null &&
          sibling.worktreePath !== null &&
          path.resolve(sibling.worktreePath) === folder,
      )
    ) {
      return;
    }
    if (!(yield* fileSystem.exists(folder))) return;
    if ((yield* fileSystem.readDirectory(folder)).length > 0) return;
    yield* Effect.tryPromise(() => NodeFSP.rmdir(folder));
  });

  const processThreadDeleted = Effect.fn("processThreadDeleted")(function* (
    event: ThreadDeletedEvent,
  ) {
    const { threadId } = event.payload;
    yield* stopProviderSession(threadId);
    yield* logCleanupCauseUnlessInterrupted({
      effect: removeEmptyScratchFolder(threadId),
      message: "thread deletion cleanup skipped scratch folder removal",
      threadId,
    });
  });

  const processThreadDeletedSafely = (event: ThreadDeletedEvent) =>
    processThreadDeleted(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("thread deletion reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processThreadDeletedSafely);

  // Highest event sequence the subscriber has handed to the worker. Waiting
  // through a successful thread.created sequence covers every deletion that
  // was ahead of that create in the engine queue; the worker drain then covers
  // the in-flight cleanup.
  const seenSequence = yield* SubscriptionRef.make(0);
  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));

  const start: ThreadDeletionReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(
        orchestrationEngine.streamDomainEvents.pipe(
          // Events that landed before the subscription are not replayed, so
          // start the watermark at the current head instead of zero.
          Stream.onStart(orchestrationEngine.latestSequence.pipe(Effect.flatMap(noteSeen))),
        ),
        (event) =>
          (event.type === "thread.deleted" ? worker.enqueue(event) : Effect.void).pipe(
            Effect.andThen(noteSeen(event.sequence)),
          ),
      ),
    );
  });

  const drainThrough: ThreadDeletionReactorShape["drainThrough"] = Effect.fn(
    "ThreadDeletionReactor.drainThrough",
  )(function* (target) {
    yield* SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= target),
      Stream.runHead,
    );
    yield* worker.drain;
  });

  return {
    start,
    drainThrough,
  } satisfies ThreadDeletionReactorShape;
});

export const ThreadDeletionReactorLive = Layer.effect(ThreadDeletionReactor, make);
