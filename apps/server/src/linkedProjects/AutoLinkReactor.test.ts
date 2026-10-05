import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { AutoLinkReactorLive } from "./AutoLinkReactor.ts";

const at = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const scratch = ProjectId.make("project-scratch");
const docs = ProjectId.make("project-docs");
const infra = ProjectId.make("project-infra");
const instanceId = ProviderInstanceId.make("codex");

const row = (projectId: ProjectId, workspaceRoot: string): ProjectStore.ProjectRow => ({
  projectId,
  title: projectId,
  workspaceRoot,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const appThread = (
  threadId: ThreadId,
  overrides: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread => ({
  createdBy: "user",
  creationSource: "web",
  id: threadId,
  projectId: scratch,
  title: "Scratch",
  providerInstanceId: instanceId,
  modelSelection: { instanceId, model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: `/data/scratch/${threadId}`,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
  ...overrides,
});

const fileChange = (
  threadId: ThreadId,
  id: string,
  path: string,
  runId = "run-1",
): OrchestrationV2DomainEvent =>
  ({
    type: "turn-item.updated",
    threadId,
    payload: {
      id: TurnItemId.make(id),
      threadId,
      runId: RunId.make(runId),
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
      type: "file_change",
      fileName: path,
      changes: [{ operation: "update", path }],
    },
  }) as unknown as OrchestrationV2DomainEvent;

const harness = (threads: ReadonlyMap<ThreadId, OrchestrationV2AppThread>) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const dispatched = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
    yield* Layer.build(
      AutoLinkReactorLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              streamDomainEvents: Stream.fromQueue(events),
              getThreadRecords: (threadId) =>
                Effect.succeed({ thread: threads.get(threadId)! }) as never,
              dispatch: (command) =>
                Queue.offer(dispatched, command).pipe(Effect.as({ sequence: 1 } as never)),
            }),
            Layer.mock(ProjectStore.ProjectStoreV2)({
              list: () =>
                Effect.succeed([
                  row(scratch, "/data/scratch"),
                  row(docs, "/work/docs"),
                  row(infra, "/work/infra"),
                ]),
            }),
            Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
              namedProjectsRoot: "/projects",
              scratchRoot: Effect.succeed(Option.some("/data/scratch")),
            }),
            NodeServices.layer,
          ),
        ),
      ),
    );
    return { events, dispatched };
  });

it.effect("links a Scratch thread to the project its agent wrote into, once per project", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-scratch");
    const { events, dispatched } = yield* harness(new Map([[threadId, appThread(threadId)]]));
    yield* Queue.offer(events, fileChange(threadId, "item-1", "/work/docs/README.md"));
    const first = yield* Queue.take(dispatched);
    assert.deepInclude(first, {
      type: "thread.metadata.update",
      threadId,
      linkProjectIds: [docs],
    });
    // A second write into the same project does not dispatch again; a new project does.
    yield* Queue.offer(events, fileChange(threadId, "item-2", "/work/docs/b.md"));
    yield* Queue.offer(events, fileChange(threadId, "item-3", "/work/infra/main.tf"));
    const second = yield* Queue.take(dispatched);
    assert.deepInclude(second, { linkProjectIds: [infra] });
  }).pipe(Effect.scoped),
);

it.effect("leaves project threads, pinned threads and own-folder writes alone", () =>
  Effect.gen(function* () {
    const projectThread = ThreadId.make("thread-project");
    const pinned = ThreadId.make("thread-pinned");
    const own = ThreadId.make("thread-own");
    const { events, dispatched } = yield* harness(
      new Map([
        [projectThread, appThread(projectThread, { projectId: docs, worktreePath: null })],
        [pinned, appThread(pinned, { projectLinksPinned: true })],
        [own, appThread(own)],
      ]),
    );
    yield* Queue.offer(events, fileChange(projectThread, "a", "/work/infra/main.tf"));
    yield* Queue.offer(events, fileChange(pinned, "b", "/work/infra/main.tf"));
    yield* Queue.offer(events, fileChange(own, "c", "/data/scratch/thread-own/notes.md"));
    // A later write that does link proves the earlier ones were processed and skipped.
    yield* Queue.offer(events, fileChange(own, "d", "/work/infra/main.tf"));
    const only = yield* Queue.take(dispatched);
    assert.deepInclude(only, { threadId: own, linkProjectIds: [infra] });
    assert.equal(yield* Queue.size(dispatched), 0);
  }).pipe(Effect.scoped),
);

it.effect("does not add links in a later run once the thread has some", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-later-run");
    const marker = ThreadId.make("thread-marker");
    const { events, dispatched } = yield* harness(
      new Map([
        [threadId, appThread(threadId, { linkedProjectIds: [docs] })],
        [marker, appThread(marker)],
      ]),
    );
    yield* Queue.offer(events, fileChange(threadId, "late", "/work/infra/main.tf", "run-2"));
    // Events are handled in order, so the marker's link proves "late" was skipped.
    yield* Queue.offer(events, fileChange(marker, "marker", "/work/infra/main.tf"));
    assert.deepInclude(yield* Queue.take(dispatched), { threadId: marker });
    assert.equal(yield* Queue.size(dispatched), 0);
  }).pipe(Effect.scoped),
);
