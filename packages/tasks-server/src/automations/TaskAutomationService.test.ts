/* oxlint-disable upcomputer/no-manual-effect-runtime-in-tests -- imported node:test suite; migrate to it.effect separately. */
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { Task, TaskAutomation } from "@upcomputer/tasks-contracts/v1";
import { TaskAgentService, type TaskAgentServiceShape } from "../agents/TaskAgentService.ts";
import { TaskRepository, type TaskRepositoryShape } from "../persistence/TaskRepository.ts";
import { TaskAutomationService, TaskAutomationServiceLive } from "./TaskAutomationService.ts";
import { AUTOMATION_FAILURE_LIMIT } from "./automationSchedule.ts";

interface RepositoryCalls {
  readonly claims: Array<{ slot: string; outcome: string }>;
  readonly outcomes: Array<{ slot: string; outcome: string }>;
  readonly scheduleWrites: Array<{
    nextRunAt: string | null;
    firedTaskId: string | null;
    failureCount: number;
  }>;
  readonly parks: Array<{ status: string; failureCount: number }>;
  readonly tasks: Task[];
  /** Any full-row write, which a scheduler pass must never perform. */
  readonly wideWrites: string[];
}

interface FakeOptions {
  readonly automations: ReadonlyArray<TaskAutomation>;
  /** Slots that a previous pass already claimed. */
  readonly claimedSlots?: ReadonlySet<string>;
  readonly openTaskCount?: number;
  /** Simulates a person pausing the automation before the pass writes back. */
  readonly scheduleWriteApplies?: boolean;
  readonly failTaskCreation?: boolean;
}

function fakeRepository(options: FakeOptions): {
  readonly layer: Layer.Layer<TaskRepository>;
  readonly calls: RepositoryCalls;
} {
  const claimed = new Set(options.claimedSlots ?? []);
  const calls: RepositoryCalls = {
    claims: [],
    outcomes: [],
    scheduleWrites: [],
    parks: [],
    tasks: [],
    wideWrites: [],
  };
  const unused = () => Effect.die("unused repository method");
  const recordWideWrite = (method: string) => (input: { id?: string }) =>
    Effect.sync(() => {
      calls.wideWrites.push(method);
      return input as never;
    });
  const shape = {
    listAutomationsByStatus: () => Effect.succeed(options.automations),
    claimAutomationSlot: (input: { slot: string; outcome: string }) =>
      Effect.sync(() => {
        calls.claims.push({ slot: input.slot, outcome: input.outcome });
        if (claimed.has(input.slot)) return false;
        claimed.add(input.slot);
        return true;
      }),
    completeAutomationRun: (input: { slot: string; outcome: string }) =>
      Effect.sync(() => {
        calls.outcomes.push({ slot: input.slot, outcome: input.outcome });
      }),
    updateAutomationSchedule: (input: {
      nextRunAt: string | null;
      firedTaskId: string | null;
      failureCount: number;
    }) =>
      Effect.sync(() => {
        calls.scheduleWrites.push({
          nextRunAt: input.nextRunAt,
          firedTaskId: input.firedTaskId,
          failureCount: input.failureCount,
        });
        return options.scheduleWriteApplies ?? true;
      }),
    parkAutomation: (input: { status: string; failureCount: number }) =>
      Effect.sync(() => {
        calls.parks.push({ status: input.status, failureCount: input.failureCount });
        return true;
      }),
    countOpenAutomationTasks: () => Effect.succeed(options.openTaskCount ?? 0),
    upsertAutomation: recordWideWrite("upsertAutomation"),
    insertAutomation: recordWideWrite("insertAutomation"),
    upsert: (task: Task) =>
      options.failTaskCreation
        ? Effect.fail(new Error("task storage is unavailable") as never)
        : Effect.sync(() => {
            calls.tasks.push(task);
            return task;
          }),
    getById: () => Effect.succeed(Option.none()),
  } as unknown as TaskRepositoryShape;

  return {
    layer: Layer.succeed(
      TaskRepository,
      new Proxy(shape, {
        get: (target, property) =>
          (target as unknown as Record<string | symbol, unknown>)[property] ?? unused,
      }) as TaskRepositoryShape,
    ),
    calls,
  };
}

/** Deterministic bytes keep generated task ids stable between runs. */
function deterministicCrypto(): Layer.Layer<Crypto.Crypto> {
  let seed = 0;
  return Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => {
        seed += 1;
        return Uint8Array.from({ length: size }, (_, index) => (seed * 31 + index) % 256);
      },
      digest: () => Effect.die("digest is unused by the scheduler"),
    }),
  );
}

const agentsLayer = Layer.succeed(TaskAgentService, {
  scheduleTaskChanged: () => Effect.void,
  scheduleAgentChanged: () => Effect.void,
  stopRun: () => Effect.succeed(Option.none()),
  messageRun: () => Effect.die("unused messageRun"),
  recover: Effect.void,
} satisfies TaskAgentServiceShape);

function automation(overrides: Partial<TaskAutomation> = {}): TaskAutomation {
  return {
    id: "automation-1",
    projectId: "project-1",
    name: "Daily check",
    status: "enabled",
    schedule: { cron: "0 9 * * *", timezone: "UTC" },
    template: {
      title: "Review dependencies",
      description: "",
      status: "new",
      priority: null,
      tags: [],
    },
    catchUpPolicy: "fire-once",
    skipIfOpen: true,
    createdBy: "user",
    sourceThreadId: null,
    // Far enough in the past that every pass sees the slot as due.
    nextRunAt: "2020-01-01T09:00:00.000Z",
    lastFiredAt: null,
    lastFiredSlot: null,
    lastTaskId: null,
    lastError: null,
    failureCount: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  } as TaskAutomation;
}

async function runTick(options: FakeOptions): Promise<RepositoryCalls> {
  const { layer, calls } = fakeRepository(options);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* TaskAutomationService;
        yield* service.tick;
      }).pipe(
        Effect.provide(
          TaskAutomationServiceLive.pipe(
            Layer.provideMerge(Layer.mergeAll(layer, agentsLayer, deterministicCrypto())),
          ),
        ),
      ),
    ),
  );
  return calls;
}

test("a due slot claims once and creates exactly one task", async () => {
  const calls = await runTick({ automations: [automation()] });

  NodeAssert.equal(calls.claims.length, 1);
  NodeAssert.equal(calls.tasks.length, 1);
  NodeAssert.equal(calls.tasks[0]?.title, "Review dependencies");
  // The task carries the automation id so `skipIfOpen` can find it later even
  // if the pointer write never happened.
  NodeAssert.equal(
    (calls.tasks[0]?.metadata as Record<string, unknown>).automationId,
    "automation-1",
  );
  NodeAssert.deepEqual(calls.outcomes, [{ slot: "2020-01-01T09:00:00.000Z", outcome: "created" }]);
  NodeAssert.equal(calls.scheduleWrites.length, 1);
  NodeAssert.equal(calls.scheduleWrites[0]?.firedTaskId, calls.tasks[0]?.id);
});

test("a slot another pass already claimed does not create a second task", async () => {
  const calls = await runTick({
    automations: [automation()],
    claimedSlots: new Set(["2020-01-01T09:00:00.000Z"]),
  });

  NodeAssert.equal(calls.tasks.length, 0);
  NodeAssert.equal(calls.outcomes.length, 0);
  // The schedule still re-arms, otherwise the automation would retry forever.
  NodeAssert.equal(calls.scheduleWrites.length, 1);
  NodeAssert.notEqual(calls.scheduleWrites[0]?.nextRunAt, "2020-01-01T09:00:00.000Z");
});

test("skipIfOpen suppresses a fire while an earlier task is still open", async () => {
  const calls = await runTick({ automations: [automation()], openTaskCount: 1 });

  NodeAssert.equal(calls.tasks.length, 0);
  NodeAssert.deepEqual(calls.outcomes, [
    { slot: "2020-01-01T09:00:00.000Z", outcome: "skipped-open" },
  ]);
  NodeAssert.equal(calls.scheduleWrites.length, 1);
});

test("skipIfOpen off still fires while a task is open", async () => {
  const calls = await runTick({
    automations: [automation({ skipIfOpen: false })],
    openTaskCount: 3,
  });

  NodeAssert.equal(calls.tasks.length, 1);
});

test("a pass that loses the row to a concurrent pause does not resurrect it", async () => {
  const calls = await runTick({ automations: [automation()], scheduleWriteApplies: false });

  // The guarded write is attempted and reports that it did not apply; nothing
  // in the pass rewrites status, so the user's pause stands.
  NodeAssert.equal(calls.scheduleWrites.length, 1);
  NodeAssert.equal(calls.parks.length, 0);
  NodeAssert.deepEqual(calls.wideWrites, []);
});

test("no scheduler path writes a whole automation row back", async () => {
  // A pass works from a snapshot taken at the start of the tick, so a full-row
  // write would revert anything a person changed in the meantime.
  for (const options of [
    { automations: [automation()] },
    { automations: [automation()], openTaskCount: 1 },
    { automations: [automation()], failTaskCreation: true },
    { automations: [automation({ catchUpPolicy: "skip" as const })] },
    { automations: [automation({ schedule: { cron: "0 99 * * *", timezone: "UTC" } })] },
    {
      automations: [automation({ failureCount: AUTOMATION_FAILURE_LIMIT - 1 })],
      failTaskCreation: true,
    },
  ]) {
    const calls = await runTick(options);
    NodeAssert.deepEqual(
      calls.wideWrites,
      [],
      `unexpected full-row write for ${JSON.stringify(options.automations[0]?.schedule)}`,
    );
  }
});

test("a failing fire records the failure and re-arms without parking", async () => {
  const calls = await runTick({ automations: [automation()], failTaskCreation: true });

  NodeAssert.deepEqual(
    calls.outcomes.map((entry) => entry.outcome),
    ["failed"],
  );
  NodeAssert.equal(calls.parks.length, 0);
  NodeAssert.equal(calls.scheduleWrites.length, 1);
  NodeAssert.equal(calls.scheduleWrites[0]?.failureCount, 1);
});

test("a repeatedly failing automation parks itself at the failure limit", async () => {
  const calls = await runTick({
    automations: [automation({ failureCount: AUTOMATION_FAILURE_LIMIT - 1 })],
    failTaskCreation: true,
  });

  NodeAssert.deepEqual(calls.parks, [
    { status: "disabled", failureCount: AUTOMATION_FAILURE_LIMIT },
  ]);
  // Parking replaces the schedule write; the row must not be re-armed.
  NodeAssert.equal(calls.scheduleWrites.length, 0);
});

test("an automation whose cron stopped parsing is parked, not retried", async () => {
  const calls = await runTick({
    automations: [automation({ schedule: { cron: "0 99 * * *", timezone: "UTC" } })],
  });

  NodeAssert.equal(calls.claims.length, 0);
  NodeAssert.equal(calls.tasks.length, 0);
  NodeAssert.deepEqual(
    calls.parks.map((entry) => entry.status),
    ["disabled"],
  );
});

test("a skipped catch-up window claims its slot but creates no task", async () => {
  const calls = await runTick({
    automations: [automation({ catchUpPolicy: "skip" })],
  });

  NodeAssert.deepEqual(
    calls.claims.map((entry) => entry.outcome),
    ["skipped-catch-up"],
  );
  NodeAssert.equal(calls.tasks.length, 0);
  NodeAssert.equal(calls.scheduleWrites.length, 1);
});
