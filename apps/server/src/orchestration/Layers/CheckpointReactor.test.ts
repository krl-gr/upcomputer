// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import {
  VcsProcessTimeoutError,
  VcsProcessSpawnError,
  ProviderDriverKind,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderInstanceId,
} from "@upcomputer/contracts";
import {
  CommandId,
  CheckpointRef,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@upcomputer/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { CheckpointReactorLive } from "./CheckpointReactor.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusLive } from "./RuntimeReceiptBus.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { ServerConfig } from "../../config.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderDriverKind;
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

function createProviderServiceHarness(
  cwd: string,
  hasSession = true,
  sessionCwd = cwd,
  providerName: ProviderSession["provider"] = ProviderDriverKind.make("codex"),
) {
  const now = "2026-01-01T00:00:00.000Z";
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const rollbackConversation = vi.fn(
    (_input: { readonly threadId: ThreadId; readonly numTurns: number }) => Effect.void,
  );
  const assertConversationRollbackSupported = vi.fn<
    ProviderServiceShape["assertConversationRollbackSupported"]
  >(() => Effect.void);

  const unsupported = <A>() =>
    Effect.die(new Error("Unsupported provider call in test")) as Effect.Effect<A, never>;
  const listSessions = () =>
    hasSession
      ? Effect.succeed([
          {
            provider: providerName,
            status: "ready",
            runtimeMode: "full-access",
            threadId: ThreadId.make("thread-1"),
            cwd: sessionCwd,
            createdAt: now,
            updatedAt: now,
          },
        ] satisfies ReadonlyArray<ProviderSession>)
      : Effect.succeed([] as ReadonlyArray<ProviderSession>);
  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions,
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    assertConversationRollbackSupported,
    getInstanceInfo: (instanceId) =>
      Effect.succeed({
        instanceId,
        driverKind: ProviderDriverKind.make(providerName),
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make(providerName),
          continuationKey: `${providerName}:instance:${instanceId}`,
        },
      }),
    rollbackConversation,
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event as unknown as ProviderRuntimeEvent));
  };

  return {
    service,
    assertConversationRollbackSupported,
    rollbackConversation,
    emit,
  };
}

async function waitForThread(
  readModel: () => Promise<{
    readonly threads: ReadonlyArray<{
      readonly id: ThreadId;
      readonly latestTurn: { readonly turnId: string } | null;
      readonly checkpoints: ReadonlyArray<{ readonly checkpointTurnCount: number }>;
      readonly activities: ReadonlyArray<{ readonly kind: string }>;
    }>;
  }>,
  predicate: (thread: {
    latestTurn: { turnId: string } | null;
    checkpoints: ReadonlyArray<{ checkpointTurnCount: number }>;
    activities: ReadonlyArray<{ kind: string }>;
  }) => boolean,
  timeoutMs = 15_000,
) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<{
    latestTurn: { turnId: string } | null;
    checkpoints: ReadonlyArray<{ checkpointTurnCount: number }>;
    activities: ReadonlyArray<{ kind: string }>;
  }> => {
    const snapshot = await readModel();
    const thread = snapshot.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    if (thread && predicate(thread)) {
      return thread;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for thread state.");
    }
    await Effect.runPromise(Effect.sleep("10 millis"));
    return poll();
  };
  return poll();
}

async function waitForEvent(
  engine: OrchestrationEngineShape,
  predicate: (event: { type: string }) => boolean,
  timeoutMs = 15_000,
) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async () => {
    const events = await Effect.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(Effect.map((chunk) => Array.from(chunk))),
    );
    if (events.some(predicate)) {
      return events;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for orchestration event.");
    }
    await Effect.runPromise(Effect.sleep("10 millis"));
    return poll();
  };
  return poll();
}

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function createGitRepository() {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-checkpoint-handler-"));
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v1\n", "utf8");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
  return cwd;
}

function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function gitShowFileAtRef(cwd: string, ref: string, filePath: string): string {
  return runGit(cwd, ["show", `${ref}:${filePath}`]);
}

async function waitForGitRefExists(cwd: string, ref: string, timeoutMs = 15_000) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<void> => {
    if (gitRefExists(cwd, ref)) {
      return;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error(`Timed out waiting for git ref '${ref}'.`);
    }
    await Effect.runPromise(Effect.sleep("10 millis"));
    return poll();
  };
  return poll();
}

describe("CheckpointReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    | OrchestrationEngineService
    | CheckpointReactor
    | CheckpointStore.CheckpointStore
    | ProjectionSnapshotQuery,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  async function createHarness(options?: {
    readonly checkpointLookupFailure?: (
      cwd: string,
    ) => VcsProcessTimeoutError | VcsProcessSpawnError | undefined;
    readonly workspaceRefresh?: (cwd: string) => Effect.Effect<void>;
    readonly hasSession?: boolean;
    readonly seedFilesystemCheckpoints?: boolean;
    readonly initializeGit?: boolean;
    readonly projectWorkspaceRoot?: string;
    readonly threadWorktreePath?: string | null;
    readonly providerSessionCwd?: string;
    readonly providerName?: ProviderDriverKind;
    readonly gitStatusRefreshCalls?: Array<string>;
  }) {
    const cwd = createGitRepository();
    if (options?.initializeGit === false) {
      NodeFS.rmSync(NodePath.join(cwd, ".git"), { recursive: true });
    }
    tempDirs.push(cwd);
    const provider = createProviderServiceHarness(
      cwd,
      options?.hasSession ?? true,
      options?.providerSessionCwd ?? cwd,
      options?.providerName ?? ProviderDriverKind.make("codex"),
    );
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );

    const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-checkpoint-reactor-test-",
    });
    const vcsStatusBroadcasterLayer = Layer.succeed(VcsStatusBroadcaster, {
      getStatus: () => Effect.die("getStatus should not be called in this test"),
      refreshLocalStatus: (cwd: string) =>
        Effect.sync(() => {
          options?.gitStatusRefreshCalls?.push(cwd);
        }).pipe(
          Effect.as({
            isRepo: true,
            hasPrimaryRemote: false,
            isDefaultRef: true,
            refName: "main",
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          }),
        ),
      refreshStatus: () => Effect.die("refreshStatus should not be called in this test"),
      streamStatus: () => Stream.empty,
    });

    const layer = CheckpointReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(RuntimeReceiptBusLive),
      Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      Layer.provideMerge(vcsStatusBroadcasterLayer),
      Layer.provideMerge(
        Layer.effect(
          CheckpointStore.CheckpointStore,
          CheckpointStore.make.pipe(
            Effect.map((store) => ({
              ...store,
              hasCheckpointRef: (input) => {
                const failure = options?.checkpointLookupFailure?.(input.cwd);
                return failure ? Effect.fail(failure) : store.hasCheckpointRef(input);
              },
            })),
          ),
        ).pipe(Layer.provide(VcsDriverRegistry.layer)),
      ),
      Layer.provideMerge(
        (options?.workspaceRefresh
          ? Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: options.workspaceRefresh })
          : WorkspaceEntries.layer
        ).pipe(Layer.provide(WorkspacePaths.layer), Layer.provideMerge(VcsDriverRegistry.layer)),
      ),
      Layer.provideMerge(WorkspacePaths.layer),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(ServerConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const reactor = await runtime.runPromise(Effect.service(CheckpointReactor));
    const checkpointStore = await runtime.runPromise(
      Effect.service(CheckpointStore.CheckpointStore),
    );
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
    const drain = () => Effect.runPromise(reactor.drain);

    const createdAt = "2026-01-01T00:00:00.000Z";
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Test Project",
        workspaceRoot: options?.projectWorkspaceRoot ?? cwd,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-create"),
        threadId: ThreadId.make("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: options?.threadWorktreePath ?? cwd,
        createdAt,
      }),
    );

    if (options?.seedFilesystemCheckpoints ?? true) {
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
        }),
      );
      NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v2\n", "utf8");
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        }),
      );
      NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v3\n", "utf8");
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 2),
        }),
      );
    }

    return {
      engine,
      readModel: () => Effect.runPromise(snapshotQuery.getSnapshot()),
      provider,
      cwd,
      drain,
    };
  }

  it("captures pre-turn baseline on turn.started and post-turn checkpoint on turn.completed", async () => {
    const harness = await createHarness({ seedFilesystemCheckpoints: false });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-capture"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-1"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-1"),
    });
    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-1"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-1"),
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.latestTurn?.turnId === "turn-1" && entry.checkpoints.length === 1,
    );
    expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0)),
    ).toBe(true);
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
    ).toBe(true);
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
        "README.md",
      ),
    ).toBe("v1\n");
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        "README.md",
      ),
    ).toBe("v2\n");
  });

  effectIt.effect("captures and reverts checkpoints from a nested Git workspace", () =>
    Effect.gen(function* () {
      const repositoryRoot = createGitRepository();
      tempDirs.push(repositoryRoot);
      const workspaceRoot = NodePath.join(repositoryRoot, "apps", "server");
      NodeFS.mkdirSync(workspaceRoot, { recursive: true });
      const filePath = NodePath.join(workspaceRoot, "index.ts");
      NodeFS.writeFileSync(filePath, "export const value = 1;\n");
      runGit(repositoryRoot, ["add", "."]);
      runGit(repositoryRoot, ["commit", "-m", "Add nested workspace"]);
      const harness = yield* Effect.promise(() =>
        createHarness({
          seedFilesystemCheckpoints: false,
          projectWorkspaceRoot: workspaceRoot,
          threadWorktreePath: workspaceRoot,
          providerSessionCwd: workspaceRoot,
        }),
      );
      const threadId = ThreadId.make("thread-1");
      const turnId = asTurnId("turn-nested");
      const createdAt = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-nested"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      });
      harness.provider.emit({
        type: "turn.started",
        eventId: EventId.make("evt-nested-start"),
        provider: ProviderDriverKind.make("codex"),
        createdAt,
        threadId,
        turnId,
      });
      yield* Effect.promise(() =>
        waitForGitRefExists(repositoryRoot, checkpointRefForThreadTurn(threadId, 0)),
      );

      NodeFS.writeFileSync(filePath, "export const value = 2;\n");
      harness.provider.emit({
        type: "turn.completed",
        eventId: EventId.make("evt-nested-complete"),
        provider: ProviderDriverKind.make("codex"),
        createdAt,
        threadId,
        turnId,
        payload: { state: "completed" },
      });
      const thread = yield* Effect.promise(() =>
        waitForThread(harness.readModel, (entry) => entry.checkpoints.length === 1),
      );
      expect(thread.checkpoints[0]).toMatchObject({
        status: "ready",
        files: [{ path: "apps/server/index.ts", additions: 1, deletions: 1 }],
      });

      yield* harness.engine.dispatch({
        type: "thread.checkpoint.revert",
        commandId: CommandId.make("cmd-nested-revert"),
        threadId,
        turnCount: 0,
        createdAt,
      });
      const reverted = yield* Effect.promise(() =>
        waitForThread(harness.readModel, (entry) => entry.checkpoints.length === 0),
      );
      expect(reverted.checkpoints).toEqual([]);
      yield* Effect.promise(harness.drain);
      expect(NodeFS.readFileSync(filePath, "utf8")).toBe("export const value = 1;\n");
      expect(harness.provider.rollbackConversation).toHaveBeenCalledWith({ threadId, numTurns: 1 });
      expect(gitRefExists(repositoryRoot, checkpointRefForThreadTurn(threadId, 1))).toBe(false);
    }),
  );

  effectIt.effect.each(["timeout", "spawn"] as const)(
    "captures and finalizes a turn when previous checkpoint lookup fails (%s)",
    (failureKind) =>
      Effect.gen(function* () {
        let failLookup = false;
        const harness = yield* Effect.promise(() =>
          createHarness({
            seedFilesystemCheckpoints: false,
            checkpointLookupFailure: (cwd) =>
              !failLookup
                ? undefined
                : failureKind === "timeout"
                  ? new VcsProcessTimeoutError({
                      operation: "test.refLookup",
                      command: "git",
                      cwd,
                      timeoutMs: 30000,
                    })
                  : new VcsProcessSpawnError({
                      operation: "test.refLookup",
                      command: "git",
                      cwd,
                      cause: new Error("transient lookup spawn failure"),
                    }),
          }),
        );
        const threadId = ThreadId.make("thread-1");
        const turnId = asTurnId("turn-ref-timeout");
        const createdAt = "2026-01-01T00:00:00.000Z";
        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-set-ref-lookup"),
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        harness.provider.emit({
          type: "turn.started",
          eventId: EventId.make("evt-ref-start"),
          provider: ProviderDriverKind.make("codex"),
          createdAt,
          threadId,
          turnId,
        });
        yield* Effect.promise(() =>
          waitForGitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 0)),
        );
        NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "new snapshot\n");
        failLookup = true;
        harness.provider.emit({
          type: "turn.completed",
          eventId: EventId.make("evt-ref-complete"),
          provider: ProviderDriverKind.make("codex"),
          createdAt: "2026-01-01T00:00:01.000Z",
          threadId,
          turnId,
          payload: { state: "completed" },
        });
        const thread = yield* Effect.promise(() =>
          waitForThread(harness.readModel, (entry) => entry.checkpoints.length === 1),
        );
        yield* Effect.promise(harness.drain);
        const ref = checkpointRefForThreadTurn(threadId, 1);
        expect(gitShowFileAtRef(harness.cwd, ref, "README.md")).toBe("new snapshot\n");
        expect(thread.checkpoints[0]).toMatchObject({
          checkpointRef: ref,
          status: "ready",
          files: [],
        });
        expect(thread.activities.some((a) => a.kind === "checkpoint.capture.failed")).toBe(false);
      }),
  );

  effectIt.effect(
    "finalizes checkpoints while entry refresh is blocked and coalesces later scans",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const refreshCalls: string[] = [];
        const harness = yield* Effect.promise(() =>
          createHarness({
            seedFilesystemCheckpoints: false,
            workspaceRefresh: (cwd) =>
              Effect.gen(function* () {
                refreshCalls.push(cwd);
                if (refreshCalls.length === 1) {
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);
                }
              }),
          }),
        );
        const threadId = ThreadId.make("thread-1");
        const createdAt = "2026-01-01T00:00:00.000Z";
        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-set-refresh"),
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        for (const index of [0, 1, 2]) {
          const turnId = asTurnId(`turn-refresh-${index}`);
          harness.provider.emit({
            type: "turn.started",
            eventId: EventId.make(`evt-refresh-start-${index}`),
            provider: ProviderDriverKind.make("codex"),
            createdAt,
            threadId,
            turnId,
          });
          yield* Effect.promise(() =>
            waitForGitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, index)),
          );
          NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), `snapshot ${index}\n`);
          harness.provider.emit({
            type: "turn.completed",
            eventId: EventId.make(`evt-refresh-complete-${index}`),
            provider: ProviderDriverKind.make("codex"),
            createdAt: "2026-01-01T00:00:01.000Z",
            threadId,
            turnId,
            payload: { state: "completed" },
          });
          yield* Effect.promise(() =>
            waitForThread(harness.readModel, (entry) => entry.checkpoints.length === index + 1),
          );
          if (index === 0) yield* Deferred.await(entered);
        }
        expect(refreshCalls).toEqual([harness.cwd]);
        expect(
          gitShowFileAtRef(harness.cwd, checkpointRefForThreadTurn(threadId, 3), "README.md"),
        ).toBe("snapshot 2\n");
        yield* Deferred.succeed(release, undefined);
        yield* Effect.promise(harness.drain);
        expect(refreshCalls).toEqual([harness.cwd, harness.cwd]);
      }),
  );

  effectIt.effect.each(["turn.completed", "turn.aborted"] as const)(
    "captures every edit after a mid-turn diff update on %s",
    (terminalEventType) =>
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() =>
          createHarness({ seedFilesystemCheckpoints: false }),
        );
        const threadId = ThreadId.make("thread-1");
        const turnId = asTurnId("turn-1");
        const assistantMessageId = MessageId.make("assistant:mid-turn");
        const createdAt = "2026-01-01T00:00:00.000Z";
        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-mid-turn-running"),
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        harness.provider.emit({
          type: "turn.started",
          eventId: EventId.make("evt-mid-turn-start"),
          provider: ProviderDriverKind.make("codex"),
          createdAt,
          threadId,
          turnId,
        });
        yield* Effect.promise(() =>
          waitForGitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 0)),
        );

        NodeFS.writeFileSync(NodePath.join(harness.cwd, "early.ts"), "export const early = 1;\n");
        yield* harness.engine.dispatch({
          type: "thread.turn.diff.complete",
          commandId: CommandId.make("cmd-mid-turn-diff"),
          threadId,
          turnId,
          completedAt: createdAt,
          checkpointRef: CheckpointRef.make("provider-diff:mid-turn"),
          assistantMessageId,
          status: "missing",
          files: [],
          checkpointTurnCount: 1,
          createdAt,
        });
        yield* Effect.promise(harness.drain);
        expect(gitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 1))).toBe(false);

        NodeFS.writeFileSync(NodePath.join(harness.cwd, "late.ts"), "export const late = 2;\n");
        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-mid-turn-settled"),
          threadId,
          session: {
            threadId,
            status: terminalEventType === "turn.aborted" ? "interrupted" : "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        harness.provider.emit({
          eventId: EventId.make("evt-mid-turn-complete"),
          provider: ProviderDriverKind.make("codex"),
          createdAt,
          threadId,
          turnId,
          ...(terminalEventType === "turn.completed"
            ? { type: "turn.completed", payload: { state: "completed" } }
            : { type: "turn.aborted", payload: { reason: "Interrupted by user." } }),
        });
        yield* Effect.promise(harness.drain);
        expect(gitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 1))).toBe(true);
        const thread = (yield* Effect.promise(harness.readModel)).threads.find(
          (entry) => entry.id === threadId,
        );
        expect(thread?.checkpoints).toHaveLength(1);
        expect(thread?.checkpoints[0]?.status).toBe("ready");
        expect(thread?.latestTurn?.state).toBe(
          terminalEventType === "turn.aborted" ? "interrupted" : "completed",
        );
        expect(thread?.checkpoints[0]?.assistantMessageId).toBe(assistantMessageId);
        expect(thread?.checkpoints[0]?.files.map((file) => file.path)).toEqual([
          "early.ts",
          "late.ts",
        ]);
        expect(
          gitShowFileAtRef(harness.cwd, checkpointRefForThreadTurn(threadId, 1), "late.ts"),
        ).toBe("export const late = 2;\n");

        const followUpTurnId = asTurnId("turn-2");
        harness.provider.emit({
          type: "turn.started",
          eventId: EventId.make("evt-follow-up-start"),
          provider: ProviderDriverKind.make("codex"),
          createdAt,
          threadId,
          turnId: followUpTurnId,
        });
        harness.provider.emit({
          type: "turn.completed",
          eventId: EventId.make("evt-follow-up-complete"),
          provider: ProviderDriverKind.make("codex"),
          createdAt,
          threadId,
          turnId: followUpTurnId,
          payload: { state: "completed" },
        });
        yield* Effect.promise(harness.drain);
        const followUp = (yield* Effect.promise(harness.readModel)).threads.find(
          (entry) => entry.id === threadId,
        );
        expect(
          followUp?.checkpoints.find((checkpoint) => checkpoint.turnId === followUpTurnId),
        ).toMatchObject({ checkpointTurnCount: 2, files: [] });
      }),
  );

  it("does not capture an aborted turn without a matching start or active session", async () => {
    const harness = await createHarness({ seedFilesystemCheckpoints: false });
    harness.provider.emit({
      type: "turn.aborted",
      eventId: EventId.make("evt-untracked-abort"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-untracked"),
      payload: { reason: "Interrupted before the turn started." },
    });
    await harness.drain();

    const thread = (await harness.readModel()).threads.find((entry) => entry.id === "thread-1");
    expect(thread?.checkpoints).toEqual([]);
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
    ).toBe(false);
  });

  it("refreshes local git status state on turn completion using the session cwd", async () => {
    const gitStatusRefreshCalls: string[] = [];
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      gitStatusRefreshCalls,
    });

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-refresh-local-status"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-refresh-local-status"),
      payload: { state: "completed" },
    });

    await harness.drain();

    expect(gitStatusRefreshCalls).toEqual([harness.cwd]);
  });

  it("ignores auxiliary thread turn completion while primary turn is active", async () => {
    const harness = await createHarness({ seedFilesystemCheckpoints: false });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-primary-running"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-main"),
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-main"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-main"),
    });
    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-aux"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-aux"),
      payload: { state: "completed" },
    });

    await harness.drain();
    const midReadModel = await harness.readModel();
    const midThread = midReadModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(midThread?.checkpoints).toHaveLength(0);

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-main"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-main"),
      payload: { state: "completed" },
    });

    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.latestTurn?.turnId === "turn-main" && entry.checkpoints.length === 1,
    );
    expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
  });

  it("captures pre-turn and completion checkpoints for claude runtime events", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      providerName: ProviderDriverKind.make("claudeAgent"),
    });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-capture-claude"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-claude-1"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-claude-1"),
    });
    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-claude-1"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-claude-1"),
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.latestTurn?.turnId === "turn-claude-1" && entry.checkpoints.length === 1,
    );

    expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
    ).toBe(true);
  });

  effectIt.effect("captures a checkpoint without a summary when the baseline is missing", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({ seedFilesystemCheckpoints: false }),
      );
      harness.provider.emit({
        type: "turn.completed",
        eventId: EventId.make("evt-turn-completed-missing-baseline"),
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-missing-baseline"),
        payload: { state: "completed" },
      });
      yield* Effect.promise(() =>
        waitForThread(harness.readModel, (entry) => entry.checkpoints.length === 1),
      );
      yield* Effect.promise(harness.drain);
      const thread = (yield* Effect.promise(harness.readModel)).threads[0];
      expect(thread?.checkpoints[0]).toMatchObject({
        status: "ready",
        checkpointTurnCount: 1,
        files: [],
      });
      expect(
        gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
      ).toBe(true);
      expect(
        thread?.activities.some((activity) => activity.kind === "checkpoint.capture.failed"),
      ).toBe(false);
    }),
  );

  effectIt.effect.each([
    { timing: "between turns", commit: false },
    { timing: "between turns", commit: true },
    { timing: "during a turn", commit: false },
    { timing: "during a turn", commit: true },
  ])("resumes checkpointing after git init $timing (commit: $commit)", ({ timing, commit }) =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({ initializeGit: false, seedFilesystemCheckpoints: false }),
      );
      const threadId = ThreadId.make("thread-1");
      const createdAt = "2026-01-01T00:00:00.000Z";
      const emit = (type: "turn.started" | "turn.completed", turn: number) =>
        harness.provider.emit({
          type,
          eventId: EventId.make(`${type}-${turn}`),
          provider: ProviderDriverKind.make("codex"),
          createdAt,
          threadId,
          turnId: asTurnId(`turn-${turn}`),
          ...(type === "turn.completed" ? { payload: { state: "completed" } } : {}),
        });
      emit("turn.started", 1);
      yield* Effect.promise(harness.drain);
      NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "before git\n");
      emit("turn.completed", 1);
      yield* Effect.promise(harness.drain);
      expect((yield* Effect.promise(harness.readModel)).threads[0]?.checkpoints).toEqual([]);

      if (timing === "during a turn") {
        emit("turn.started", 2);
        yield* Effect.promise(harness.drain);
      }
      runGit(harness.cwd, ["init", "--initial-branch=main"]);
      if (commit) {
        runGit(harness.cwd, ["add", "."]);
        runGit(harness.cwd, [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "Initial",
        ]);
      }
      if (timing === "between turns") {
        // Exercise the domain entry point as well as the provider turn-start event.
        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-after-git-init"),
          threadId,
          message: {
            messageId: MessageId.make("message-after-git-init"),
            role: "user",
            text: "continue",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        });
        yield* Effect.promise(() =>
          waitForGitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 0)),
        );
        emit("turn.started", 2);
        yield* Effect.promise(harness.drain);
      }
      NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "after git\n");
      emit("turn.completed", 2);
      yield* Effect.promise(() =>
        waitForThread(harness.readModel, (entry) => entry.checkpoints.length === 1),
      );
      yield* Effect.promise(harness.drain);
      const firstCheckpoint = (yield* Effect.promise(harness.readModel)).threads[0]?.checkpoints[0];
      expect(firstCheckpoint?.checkpointTurnCount).toBe(1);
      expect(firstCheckpoint?.files).toEqual(
        timing === "between turns"
          ? [{ path: "README.md", kind: "modified", additions: 1, deletions: 1 }]
          : [],
      );
      expect(
        gitShowFileAtRef(harness.cwd, checkpointRefForThreadTurn(threadId, 1), "README.md"),
      ).toBe("after git\n");
      expect(gitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 0))).toBe(
        timing === "between turns",
      );

      emit("turn.started", 3);
      yield* Effect.promise(harness.drain);
      NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "next turn\n");
      emit("turn.completed", 3);
      yield* Effect.promise(() =>
        waitForThread(harness.readModel, (entry) => entry.checkpoints.length === 2),
      );
      yield* Effect.promise(harness.drain);
      const thread = (yield* Effect.promise(harness.readModel)).threads[0];
      expect(thread?.checkpoints[1]?.checkpointTurnCount).toBe(2);
      expect(thread?.checkpoints[1]?.files).toEqual([
        { path: "README.md", kind: "modified", additions: 1, deletions: 1 },
      ]);
      expect(
        thread?.activities.some((activity) => activity.kind === "checkpoint.capture.failed"),
      ).toBe(false);
    }),
  );

  it("captures pre-turn baseline from project workspace root when thread worktree is unset", async () => {
    const harness = await createHarness({
      hasSession: false,
      seedFilesystemCheckpoints: false,
      threadWorktreePath: null,
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-for-baseline"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-user-1"),
          role: "user",
          text: "start turn",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
        "README.md",
      ),
    ).toBe("v1\n");
  });

  it("captures turn completion checkpoint from project workspace root when provider session cwd is unavailable", async () => {
    const harness = await createHarness({
      hasSession: false,
      seedFilesystemCheckpoints: false,
      threadWorktreePath: null,
    });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-missing-provider-cwd"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-missing-cwd"),
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-missing-provider-cwd"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-missing-cwd"),
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
    ).toBe(true);
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        "README.md",
      ),
    ).toBe("v2\n");
  });

  it("ignores non-v2 checkpoint.captured runtime events", async () => {
    const harness = await createHarness();
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-checkpoint-captured"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "checkpoint.captured",
      eventId: EventId.make("evt-checkpoint-captured-3"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-3"),
      turnCount: 3,
      status: "completed",
    });

    await harness.drain();
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.checkpoints.some((checkpoint) => checkpoint.checkpointTurnCount === 3)).toBe(
      false,
    );
  });

  it("continues processing runtime events after a single checkpoint runtime failure", async () => {
    const nonRepositorySessionCwd = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-checkpoint-runtime-non-repo-"),
    );
    tempDirs.push(nonRepositorySessionCwd);

    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      providerSessionCwd: nonRepositorySessionCwd,
    });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-non-repo-runtime"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-runtime-capture-failure"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-runtime-failure"),
      payload: { state: "completed" },
    });

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-after-runtime-failure"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-after-runtime-failure"),
    });

    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0)),
    ).toBe(true);
  });

  it.each([
    { commandType: "thread.checkpoint.revert", initializeGit: true },
    { commandType: "thread.conversation.revert", initializeGit: true },
    { commandType: "thread.conversation.revert", initializeGit: false },
  ] as const)(
    "$commandType rewinds history with the requested filesystem behavior (git: $initializeGit)",
    async ({ commandType, initializeGit }) => {
      const harness = await createHarness({
        initializeGit,
        seedFilesystemCheckpoints: initializeGit,
      });
      const createdAt = "2026-01-01T00:00:00.000Z";

      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-set"),
          threadId: ThreadId.make("thread-1"),
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        }),
      );

      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.diff.complete",
          commandId: CommandId.make("cmd-diff-1"),
          threadId: ThreadId.make("thread-1"),
          turnId: asTurnId("turn-1"),
          completedAt: createdAt,
          checkpointRef: initializeGit
            ? checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)
            : CheckpointRef.make("provider-diff:thread-1:turn-1"),
          status: initializeGit ? "ready" : "missing",
          files: [],
          checkpointTurnCount: 1,
          createdAt,
        }),
      );
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.diff.complete",
          commandId: CommandId.make("cmd-diff-2"),
          threadId: ThreadId.make("thread-1"),
          turnId: asTurnId("turn-2"),
          completedAt: createdAt,
          checkpointRef: initializeGit
            ? checkpointRefForThreadTurn(ThreadId.make("thread-1"), 2)
            : CheckpointRef.make("provider-diff:thread-1:turn-2"),
          status: initializeGit ? "ready" : "missing",
          files: [],
          checkpointTurnCount: 2,
          createdAt,
        }),
      );

      NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "staged edit\n");
      if (initializeGit) {
        NodeChildProcess.execFileSync("git", ["add", "README.md"], { cwd: harness.cwd });
      }
      NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "unstaged edit\n");
      NodeFS.writeFileSync(NodePath.join(harness.cwd, "scratch.txt"), "untracked edit\n");
      const indexBefore = initializeGit
        ? NodeChildProcess.execFileSync("git", ["ls-files", "--stage"], {
            cwd: harness.cwd,
            encoding: "utf8",
          })
        : undefined;

      await Effect.runPromise(
        harness.engine.dispatch({
          type: commandType,
          commandId: CommandId.make("cmd-revert-request"),
          threadId: ThreadId.make("thread-1"),
          turnCount: 1,
          createdAt,
        }),
      );

      await waitForEvent(harness.engine, (event) => event.type === "thread.reverted");
      const thread = await waitForThread(
        harness.readModel,
        (entry) => entry.checkpoints.length === 1,
      );

      expect(thread.latestTurn?.turnId).toBe("turn-1");
      expect(thread.checkpoints).toHaveLength(1);
      expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
      expect(harness.provider.rollbackConversation).toHaveBeenCalledTimes(1);
      expect(harness.provider.rollbackConversation).toHaveBeenCalledWith({
        threadId: ThreadId.make("thread-1"),
        numTurns: 1,
      });
      expect(NodeFS.readFileSync(NodePath.join(harness.cwd, "README.md"), "utf8")).toBe(
        commandType === "thread.conversation.revert" ? "unstaged edit\n" : "v2\n",
      );
      if (commandType === "thread.conversation.revert") {
        expect(NodeFS.readFileSync(NodePath.join(harness.cwd, "scratch.txt"), "utf8")).toBe(
          "untracked edit\n",
        );
        if (initializeGit) {
          expect(
            NodeChildProcess.execFileSync("git", ["ls-files", "--stage"], {
              cwd: harness.cwd,
              encoding: "utf8",
            }),
          ).toBe(indexBefore);
        }
      }
      if (initializeGit) {
        expect(
          gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 2)),
        ).toBe(false);
      } else {
        expect(NodeFS.existsSync(NodePath.join(harness.cwd, ".git"))).toBe(false);
      }
    },
  );

  it("executes provider revert and emits thread.reverted for claude sessions", async () => {
    const harness = await createHarness({ providerName: ProviderDriverKind.make("claudeAgent") });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-claude"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-diff-claude-1"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-claude-1"),
        completedAt: createdAt,
        checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        status: "ready",
        files: [],
        checkpointTurnCount: 1,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-diff-claude-2"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-claude-2"),
        completedAt: createdAt,
        checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 2),
        status: "ready",
        files: [],
        checkpointTurnCount: 2,
        createdAt,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.checkpoint.revert",
        commandId: CommandId.make("cmd-revert-request-claude"),
        threadId: ThreadId.make("thread-1"),
        turnCount: 1,
        createdAt,
      }),
    );

    await waitForEvent(harness.engine, (event) => event.type === "thread.reverted");
    expect(harness.provider.rollbackConversation).toHaveBeenCalledTimes(1);
    expect(harness.provider.rollbackConversation).toHaveBeenCalledWith({
      threadId: ThreadId.make("thread-1"),
      numTurns: 1,
    });
  });

  it("processes consecutive revert requests with deterministic rollback sequencing", async () => {
    const harness = await createHarness();
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-inline-revert"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-inline-revert-diff-1"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-1"),
        completedAt: createdAt,
        checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        status: "ready",
        files: [],
        checkpointTurnCount: 1,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-inline-revert-diff-2"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-2"),
        completedAt: createdAt,
        checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 2),
        status: "ready",
        files: [],
        checkpointTurnCount: 2,
        createdAt,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.checkpoint.revert",
        commandId: CommandId.make("cmd-sequenced-revert-request-1"),
        threadId: ThreadId.make("thread-1"),
        turnCount: 1,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.checkpoint.revert",
        commandId: CommandId.make("cmd-sequenced-revert-request-0"),
        threadId: ThreadId.make("thread-1"),
        turnCount: 0,
        createdAt,
      }),
    );

    await harness.drain();

    expect(harness.provider.rollbackConversation).toHaveBeenCalledTimes(2);
    expect(harness.provider.rollbackConversation.mock.calls[0]?.[0]).toEqual({
      threadId: ThreadId.make("thread-1"),
      numTurns: 1,
    });
    expect(harness.provider.rollbackConversation.mock.calls[1]?.[0]).toEqual({
      threadId: ThreadId.make("thread-1"),
      numTurns: 1,
    });
  });

  it.each([false, true])(
    "reverts without an active session using project cwd fallback: %s",
    async (useProjectCwd) => {
      const harness = await createHarness({
        hasSession: false,
        ...(useProjectCwd ? { threadWorktreePath: null } : {}),
      });
      const createdAt = "2026-01-01T00:00:00.000Z";

      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.diff.complete",
          commandId: CommandId.make("cmd-diff-before-session-recovery"),
          threadId: ThreadId.make("thread-1"),
          turnId: asTurnId("turn-1"),
          completedAt: createdAt,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
          status: "ready",
          files: [],
          checkpointTurnCount: 1,
          createdAt,
        }),
      );
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.checkpoint.revert",
          commandId: CommandId.make("cmd-revert-no-session"),
          threadId: ThreadId.make("thread-1"),
          turnCount: 0,
          createdAt,
        }),
      );

      await waitForEvent(harness.engine, (event) => event.type === "thread.reverted");
      expect(harness.provider.rollbackConversation).toHaveBeenCalledWith({
        threadId: ThreadId.make("thread-1"),
        numTurns: 1,
      });
      expect(NodeFS.readFileSync(NodePath.join(harness.cwd, "README.md"), "utf8")).toBe("v1\n");
    },
  );
});
