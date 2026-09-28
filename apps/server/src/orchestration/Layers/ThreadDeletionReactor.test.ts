import {
  CommandId,
  CorrelationId,
  EventId,
  type OrchestrationEvent,
  ProjectId,
  ThreadId,
} from "@upcomputer/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import {
  type ProjectionThread,
  ProjectionThreadRepository,
  type ProjectionThreadRepositoryShape,
} from "../../persistence/Services/ProjectionThreads.ts";
import { scratchWorkspaceRootFor } from "../../project/scratchWorkspace.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import {
  logCleanupCauseUnlessInterrupted,
  ThreadDeletionReactorLive,
} from "./ThreadDeletionReactor.ts";

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.make("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("ThreadDeletionReactor drain", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const threadId = ThreadId.make("thread-deletion-reactor-drain");
  const deletedEvent = (sequence: number): OrchestrationEvent => ({
    sequence,
    eventId: EventId.make(`evt-deleted-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.deleted",
    occurredAt: now,
    commandId: CommandId.make(`cmd-deleted-${sequence}`),
    causationEventId: null,
    correlationId: CorrelationId.make(`cmd-deleted-${sequence}`),
    metadata: {},
    payload: { threadId, deletedAt: now },
  });

  effectIt.effect("waits for a published deletion the subscriber has not consumed yet", () =>
    Effect.gen(function* () {
      const stops: Array<number> = [];
      const firstCleanupDone = yield* Deferred.make<void>();
      // The engine has already committed and published sequence 2, but the
      // subscriber has not received it yet: the stream releases it on demand.
      const releaseSecondEvent = yield* Deferred.make<void>();
      const latestSequence = yield* Ref.make(0);
      const engine = {
        latestSequence: Ref.get(latestSequence),
        streamDomainEvents: Stream.concat(
          Stream.make(deletedEvent(1)),
          Stream.fromEffect(Deferred.await(releaseSecondEvent)).pipe(
            Stream.map(() => deletedEvent(2)),
          ),
        ),
      } as unknown as OrchestrationEngineShape;
      const providerService = {
        stopSession: () =>
          Effect.gen(function* () {
            stops.push(stops.length + 1);
            if (stops.length === 1) {
              yield* Deferred.succeed(firstCleanupDone, undefined);
            }
          }),
      } as unknown as ProviderServiceShape;
      const layer = ThreadDeletionReactorLive.pipe(
        Layer.provide(Layer.succeed(ProviderService, providerService)),
        Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
        Layer.provide(
          Layer.succeed(ProjectionThreadRepository, {
            getById: () => Effect.succeed(Option.none()),
          } as unknown as ProjectionThreadRepositoryShape),
        ),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-deletion-drain-" })),
        Layer.provide(NodeServices.layer),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* ThreadDeletionReactor;
          yield* reactor.start();
          yield* Deferred.await(firstCleanupDone);

          // Sequence 1 is fully cleaned and the worker queue is idle. Sequence
          // 2 is committed and published but still in flight to the subscriber.
          yield* Ref.set(latestSequence, 2);
          const drained = yield* Effect.forkChild(reactor.drainThrough(2));
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
          expect(stops).toEqual([1]);
          expect(drained.pollUnsafe()).toBeUndefined();

          yield* Deferred.succeed(releaseSecondEvent, undefined);
          yield* Fiber.join(drained);
          expect(stops).toEqual([1, 2]);
        }),
      ).pipe(Effect.provide(layer));
    }),
  );
});

describe("ThreadDeletionReactor scratch folders", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const projectId = ProjectId.make("project-scratch");

  effectIt.effect("removes only an empty direct child of the scratch root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-deletion-scratch-",
      });
      const scratchRoot = scratchWorkspaceRootFor(path, baseDir);
      const folders = {
        empty: path.join(scratchRoot, "2026-01-01-empty-a1b2c3d4"),
        full: path.join(scratchRoot, "2026-01-01-full-b1b2c3d4"),
        outside: path.join(baseDir, "outside"),
        nestedParent: path.join(scratchRoot, "2026-01-01-parent-c1b2c3d4"),
        nested: path.join(scratchRoot, "2026-01-01-parent-c1b2c3d4", "child"),
        dotted: path.join(scratchRoot, "2026-01-01-dotted-d1b2c3d4"),
        shared: path.join(scratchRoot, "2026-01-01-shared-e1b2c3d4"),
      };
      for (const folder of Object.values(folders)) {
        yield* fileSystem.makeDirectory(folder, { recursive: true });
      }
      yield* fileSystem.writeFileString(path.join(folders.full, "notes.md"), "keep me");

      const worktreePaths: Record<string, string> = {
        "thread-empty": folders.empty,
        "thread-full": folders.full,
        "thread-outside": folders.outside,
        "thread-nested": folders.nested,
        // Resolves to a direct child, but a `..` segment is never trusted.
        "thread-dotted": `${scratchRoot}${path.sep}x${path.sep}..${path.sep}${path.basename(folders.dotted)}`,
        "thread-shared": folders.shared,
      };
      const row = (threadId: string, deletedAt: string | null): ProjectionThread =>
        ({
          threadId: ThreadId.make(threadId),
          projectId,
          worktreePath: worktreePaths[threadId] ?? null,
          deletedAt,
        }) as unknown as ProjectionThread;
      const deletedIds = Object.keys(worktreePaths);
      const threadRepository = {
        getById: ({ threadId }: { readonly threadId: ThreadId }) =>
          Effect.succeed(Option.some(row(threadId, now))),
        listByProjectId: () =>
          Effect.succeed([
            ...deletedIds.map((threadId) => row(threadId, now)),
            // A live thread still runs in the shared folder.
            { ...row("thread-shared-live", null), worktreePath: folders.shared },
          ]),
      } as unknown as ProjectionThreadRepositoryShape;
      const events = deletedIds.map(
        (threadId, index): OrchestrationEvent => ({
          sequence: index + 1,
          eventId: EventId.make(`evt-scratch-deleted-${index}`),
          aggregateKind: "thread",
          aggregateId: ThreadId.make(threadId),
          type: "thread.deleted",
          occurredAt: now,
          commandId: CommandId.make(`cmd-scratch-deleted-${index}`),
          causationEventId: null,
          correlationId: CorrelationId.make(`cmd-scratch-deleted-${index}`),
          metadata: {},
          payload: { threadId: ThreadId.make(threadId), deletedAt: now },
        }),
      );
      const engine = {
        latestSequence: Effect.succeed(0),
        streamDomainEvents: Stream.fromIterable(events),
      } as unknown as OrchestrationEngineShape;
      const providerService = {
        stopSession: () => Effect.void,
      } as unknown as ProviderServiceShape;
      const layer = ThreadDeletionReactorLive.pipe(
        Layer.provide(Layer.succeed(ProviderService, providerService)),
        Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
        Layer.provide(Layer.succeed(ProjectionThreadRepository, threadRepository)),
        Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* ThreadDeletionReactor;
          yield* reactor.start();
          yield* reactor.drainThrough(events.length);
        }),
      ).pipe(Effect.provide(layer));

      expect(yield* fileSystem.exists(folders.empty)).toBe(false);
      expect(yield* fileSystem.exists(folders.full)).toBe(true);
      expect(yield* fileSystem.exists(folders.outside)).toBe(true);
      expect(yield* fileSystem.exists(folders.nested)).toBe(true);
      expect(yield* fileSystem.exists(folders.nestedParent)).toBe(true);
      expect(yield* fileSystem.exists(folders.dotted)).toBe(true);
      expect(yield* fileSystem.exists(folders.shared)).toBe(true);
      expect(yield* fileSystem.exists(scratchRoot)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
