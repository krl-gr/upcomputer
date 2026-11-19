import * as NodeAssert from "node:assert/strict";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { OpenCodeSettings } from "../settings.ts";
import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import * as OpenCodeServerOwner from "./OpenCodeServerOwner.ts";
import { checkOpenCodeProviderStatus, type OpenCode2Model } from "./status.ts";
import type { ProbedOpenCode } from "./versionProbe.ts";

const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const runtimeError = (
  operation: string,
  reason?: "databaseLocked" | "timeout" | "version_unsupported",
) =>
  new OpenCodeRuntime.OpenCodeRuntimeError({
    operation,
    // Paths and CLI output stay in `detail`, never in the category.
    detail: "/Users/someone/.local/share/opencode/opencode.db: failed",
    ...(reason === undefined ? {} : { reason }),
  });

const inventoryWithModels = (models: Record<string, unknown>) =>
  ({
    providerList: {
      connected: ["opencode"],
      all: [{ id: "opencode", name: "OpenCode Zen", models }],
      default: {},
    },
    agents: [],
    skills: [],
    commands: [],
  }) as unknown as OpenCodeRuntime.OpenCodeInventory;

const READY_INVENTORY = inventoryWithModels({
  "big-pickle": { id: "big-pickle", name: "Big Pickle", variants: {} },
});

interface Fixture {
  readonly probe?: Effect.Effect<ProbedOpenCode, OpenCodeRuntime.OpenCodeRuntimeError>;
  readonly start?: Effect.Effect<never, OpenCodeRuntime.OpenCodeRuntimeError>;
  readonly connect?: Effect.Effect<never, OpenCodeRuntime.OpenCodeRuntimeError>;
  readonly inventory?: () => Effect.Effect<
    OpenCodeRuntime.OpenCodeInventory,
    OpenCodeRuntime.OpenCodeRuntimeError
  >;
  readonly openCode2Models?: Effect.Effect<
    ReadonlyArray<OpenCode2Model>,
    OpenCodeRuntime.OpenCodeRuntimeError
  >;
  readonly serverUrl?: string;
}

const runtimeDouble = (fixture: Fixture): OpenCodeRuntime.OpenCodeRuntime["Service"] => ({
  startOpenCodeServerProcess: () =>
    fixture.start ??
    Effect.succeed({
      url: "http://127.0.0.1:4301",
      version: "1.14.19",
      isRunning: Effect.succeed(true),
      exitCode: Effect.never,
    }),
  connectToOpenCodeServer: ({ serverUrl }) =>
    fixture.connect ??
    Effect.succeed({
      url: serverUrl ?? "http://127.0.0.1:4301",
      version: "1.14.19",
      exitCode: null,
      external: Boolean(serverUrl),
    }),
  runOpenCodeCommand: () => Effect.succeed({ stdout: "", stderr: "", code: 0 }),
  createOpenCodeSdkClient: () =>
    ({}) as unknown as ReturnType<
      OpenCodeRuntime.OpenCodeRuntime["Service"]["createOpenCodeSdkClient"]
    >,
  loadOpenCodeInventory: () => fixture.inventory?.() ?? Effect.succeed(READY_INVENTORY),
  loadOpenCodeSkills: () => Effect.succeed([]),
});

const check = (fixture: Fixture) => {
  const runtime = runtimeDouble(fixture);
  const settings = decodeOpenCodeSettings({
    enabled: true,
    binaryPath: "opencode",
    serverUrl: fixture.serverUrl ?? "",
    serverPassword: "",
    customModels: [],
  });
  return Effect.scoped(
    Effect.gen(function* () {
      const serverOwner = yield* OpenCodeServerOwner.make({
        binaryPath: settings.binaryPath,
        directory: process.cwd(),
      });
      return yield* checkOpenCodeProviderStatus(
        settings,
        process.cwd(),
        fixture.probe ?? Effect.succeed({ generation: "v1", version: "1.14.19" }),
        fixture.openCode2Models ?? Effect.succeed([]),
        // No catalog refresh, so a test clock reaches only the inventory's deadline.
        { OPENCODE_DISABLE_MODELS_FETCH: "true" },
      ).pipe(Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, serverOwner));
    }),
  ).pipe(Effect.provideService(OpenCodeRuntime.OpenCodeRuntime, runtime));
};

const V2 = Effect.succeed({ generation: "v2", version: "2.0.18" } as const);

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "checkOpenCodeProviderStatus statusReason",
  (it) => {
    it.effect.each<{ readonly name: string; readonly reason: string | undefined } & Fixture>([
      { name: "a ready check", reason: undefined },
      {
        name: "a failed version probe",
        reason: "unknown",
        probe: Effect.fail(runtimeError("runOpenCodeCommand")),
      },
      {
        name: "a timed-out version probe",
        reason: "startup_timeout",
        probe: Effect.fail(runtimeError("probeOpenCodeBinary", "timeout")),
      },
      {
        name: "a locked database at serve",
        reason: "migration",
        start: Effect.fail(runtimeError("startOpenCodeServerProcess", "databaseLocked")),
      },
      {
        name: "a timed-out serve",
        reason: "startup_timeout",
        start: Effect.fail(runtimeError("startOpenCodeServerProcess", "timeout")),
      },
      {
        name: "a serve that exited during startup",
        reason: "unknown",
        start: Effect.fail(runtimeError("startOpenCodeServerProcess")),
      },
      {
        name: "a failed model list",
        reason: "models_missing",
        inventory: () => Effect.fail(runtimeError("provider.list")),
      },
      {
        name: "an empty model catalog",
        reason: "models_missing",
        inventory: () => Effect.succeed(inventoryWithModels({})),
      },
      {
        name: "an OpenCode 2 model list that failed",
        reason: "models_missing",
        probe: V2,
        openCode2Models: Effect.fail(runtimeError("model.list")),
      },
      {
        name: "an OpenCode 2 with no models",
        reason: "models_missing",
        probe: V2,
      },
      {
        name: "a configured server that rejects the password",
        reason: "auth",
        serverUrl: "http://127.0.0.1:4096",
        connect: Effect.fail(
          new OpenCodeRuntime.OpenCodeRuntimeError({
            operation: "global.health",
            detail: "401 Unauthorized",
          }),
        ),
      },
    ])("reports $name as $reason", ({ name: _name, reason, ...fixture }) =>
      Effect.gen(function* () {
        const snapshot = yield* check(fixture);

        NodeAssert.equal(snapshot.status === "ready", reason === undefined);
        NodeAssert.equal(snapshot.statusReason, reason);
      }),
    );

    it.effect("ends a check whose model list never answers, so the next one can run", () =>
      Effect.gen(function* () {
        let inventoryCalls = 0;
        const fixture: Fixture = {
          inventory: () => {
            inventoryCalls += 1;
            return inventoryCalls === 1 ? Effect.never : Effect.succeed(READY_INVENTORY);
          },
        };
        const hung = yield* check(fixture).pipe(Effect.forkChild);

        yield* Effect.yieldNow;
        yield* TestClock.adjust("15 seconds");
        const timedOut = yield* Fiber.join(hung);
        NodeAssert.equal(timedOut.status, "error");
        NodeAssert.equal(timedOut.statusReason, "startup_timeout");

        const retried = yield* check(fixture);
        NodeAssert.equal(retried.status, "ready");
      }).pipe(Effect.provide(TestClock.layer())),
    );
  },
);
