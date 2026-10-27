import { assert, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_LINKED_USER_ID } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { registerHeartbeatCounts } from "./HeartbeatCounts.ts";
import { countBucket, heartbeatFeatureProperties } from "./StartupHeartbeat.ts";

const provider = (overrides: Partial<ServerProvider>) =>
  ({
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    ...overrides,
  }) as ServerProvider;

const schedule = (type: "interval" | "webhook", enabled = true) =>
  ({ enabled, schedule: { type } }) as never;

const layer = (input: {
  readonly host?: string;
  readonly linked?: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settled: ReadonlyArray<ServerProvider>;
}) =>
  Layer.mergeAll(
    Layer.succeed(ServerConfig.ServerConfig, {
      host: input.host,
      tailscaleServeEnabled: false,
    } as never),
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: (name) =>
        Effect.succeed(
          input.linked === true && name === CLOUD_LINKED_USER_ID
            ? Option.some(new Uint8Array([1]))
            : Option.none(),
        ),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed(input.providers),
      streamChanges: Stream.make(input.settled),
    }),
    Layer.mock(ScheduledTaskService.ScheduledTaskService)({
      list: () =>
        Effect.succeed({
          tasks: [
            schedule("interval"),
            schedule("interval"),
            schedule("interval", false),
            schedule("webhook"),
          ],
        } as never),
    }),
  );

it("buckets counts so an install's setup shows without its exact size", () => {
  assert.deepEqual([0, 1, 2, 4, 5, 9, 10, 24, 25, 99, 100, 499, 500, 9_000].map(countBucket), [
    ...["0", "1", "2-4", "2-4", "5-9", "5-9", "10-24", "10-24"],
    ...["25-99", "25-99", "100-499", "100-499", "500+", "500+"],
  ]);
});

it.effect("reports what the install set up, waiting for provider probes to finish", () =>
  Effect.gen(function* () {
    yield* registerHeartbeatCounts(Effect.succeed({ agentTaskCount: 12, botCount: 1 }));
    const properties = yield* heartbeatFeatureProperties.pipe(
      Effect.provide(
        layer({
          linked: true,
          // Before the first probe the CLI reads as missing.
          providers: [provider({ installed: false, statusPending: true }), provider({})],
          settled: [
            provider({}),
            provider({}),
            provider({ auth: { status: "unauthenticated" } as never }),
            provider({ enabled: false }),
          ],
        }),
      ),
    );
    assert.deepEqual(properties, {
      agentTaskCount: "10-24",
      botCount: "1",
      scheduledTaskCount: "2-4",
      webhookCount: "1",
      configuredProviderCount: "2-4",
      remoteAccess: true,
    });
  }).pipe(Effect.scoped),
);

it.effect("counts remote access off for a loopback server that is not linked", () =>
  Effect.gen(function* () {
    const properties = yield* heartbeatFeatureProperties.pipe(
      Effect.provide(layer({ host: "127.0.0.1", providers: [], settled: [] })),
    );
    assert.strictEqual(properties.remoteAccess, false);
    assert.strictEqual(properties.configuredProviderCount, "0");
    const lan = yield* heartbeatFeatureProperties.pipe(
      Effect.provide(layer({ host: "0.0.0.0", providers: [], settled: [] })),
    );
    assert.strictEqual(lan.remoteAccess, true);
  }),
);
