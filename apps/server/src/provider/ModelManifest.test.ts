import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  BUNDLED_MODEL_MANIFEST,
  make,
  type ModelManifestData,
  encodeManifestCache,
} from "./ModelManifest.ts";

// Remote fixtures date after the bundle so a fetch still outranks it.
const REMOTE_UPDATED_AT = "2099-01-01T00:00:00Z";

const REMOTE_MANIFEST: ModelManifestData = {
  version: 1,
  updatedAt: REMOTE_UPDATED_AT,
  currentModels: {},
  providers: {
    claudeAgent: {
      profiles: {
        synthetic: {
          adapter: { claudeCode: { effortMap: { extreme: "high" } } },
        },
      },
      models: [
        {
          slug: "remote-only-model",
          name: "Remote Only Model",
          status: "current",
          profile: "synthetic",
        },
      ],
    },
  },
};

const remoteClaudeManifestWithCompatibility = (compatibility: unknown): ModelManifestData => ({
  ...REMOTE_MANIFEST,
  providers: {
    claudeAgent: {
      profiles: REMOTE_MANIFEST.providers!.claudeAgent!.profiles,
      models: REMOTE_MANIFEST.providers!.claudeAgent!.models.map((model) => ({
        ...model,
        adapter: { claudeCode: compatibility },
      })),
    },
  },
});

const INVALID_REMOTE_MANIFESTS: ReadonlyArray<ModelManifestData> = [
  {
    ...REMOTE_MANIFEST,
    providers: {
      claudeAgent: {
        profiles: {
          synthetic: {
            adapter: { claudeCode: { effortMap: { extreme: 123 } } },
          },
        },
        models: REMOTE_MANIFEST.providers!.claudeAgent!.models,
      },
    },
  },
  {
    ...REMOTE_MANIFEST,
    providers: {
      claudeAgent: {
        profiles: {},
        models: REMOTE_MANIFEST.providers!.claudeAgent!.models,
      },
    },
  },
  {
    ...REMOTE_MANIFEST,
    providers: {
      claudeAgent: {
        profiles: REMOTE_MANIFEST.providers!.claudeAgent!.profiles,
        models: [
          ...REMOTE_MANIFEST.providers!.claudeAgent!.models,
          {
            slug: "remote-only-model",
            name: "Duplicate Remote Model",
            status: "current",
            profile: "synthetic",
          },
        ],
      },
    },
  },
  {
    ...REMOTE_MANIFEST,
    providers: {
      claudeAgent: {
        defaults: { chat: "absent-model" },
        profiles: REMOTE_MANIFEST.providers!.claudeAgent!.profiles,
        models: REMOTE_MANIFEST.providers!.claudeAgent!.models,
      },
    },
  },
  remoteClaudeManifestWithCompatibility({ minVersion: "2.x" }),
  remoteClaudeManifestWithCompatibility({ maxVersionExclusive: "2.x" }),
  remoteClaudeManifestWithCompatibility({
    minVersion: "2.2",
    maxVersionExclusive: "2.1",
  }),
];

const httpClientLayer = (handler: () => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler()))),
  );

const serviceLayers = (input: {
  readonly prefix: string;
  readonly response: () => Response;
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
}) =>
  ServerConfig.layerTest(process.cwd(), { prefix: input.prefix }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(ServerSettings.layerTest(input.settings ?? {})),
    Layer.provideMerge(httpClientLayer(input.response)),
  );

describe("ModelManifest service", () => {
  it.live("explicit refresh bypasses fresh memory and disk caches", () => {
    let fetchCount = 0;
    const updated: ModelManifestData = {
      ...REMOTE_MANIFEST,
      currentModels: { codex: ["gpt-reloaded"] },
    };
    return Effect.gen(function* () {
      const service = yield* make;
      assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
      assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
      assert.strictEqual(fetchCount, 1);

      const rebooted = yield* make;
      assert.deepStrictEqual(yield* rebooted.refresh, REMOTE_MANIFEST);
      assert.strictEqual(fetchCount, 1);
      assert.deepStrictEqual(yield* rebooted.forceRefresh, updated);
      assert.strictEqual(fetchCount, 2);
      assert.deepStrictEqual(yield* rebooted.current, updated);
      assert.deepStrictEqual(yield* (yield* make).current, updated);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-force-refresh-test",
          response: () => Response.json(fetchCount++ === 0 ? REMOTE_MANIFEST : updated),
        }),
      ),
    );
  });

  it.live("explicit refresh retries immediately after failure and preserves last-good data", () => {
    let fetchCount = 0;
    return Effect.gen(function* () {
      const service = yield* make;
      assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
      assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
      assert.deepStrictEqual(yield* service.current, REMOTE_MANIFEST);
      assert.deepStrictEqual(yield* (yield* make).current, REMOTE_MANIFEST);
      assert.strictEqual(fetchCount, 2);
      assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
      assert.strictEqual(fetchCount, 3);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-force-retry-test",
          response: () =>
            fetchCount++ === 1
              ? new Response(null, { status: 503 })
              : Response.json(REMOTE_MANIFEST),
        }),
      ),
    );
  });

  it.live("explicit refresh bypasses the retry delay after an initial failure", () => {
    let fetchCount = 0;
    return Effect.gen(function* () {
      const service = yield* make;
      assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
      assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
      assert.strictEqual(fetchCount, 1);
      assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
      assert.strictEqual(fetchCount, 2);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-force-initial-retry-test",
          response: () =>
            fetchCount++ === 0
              ? new Response(null, { status: 503 })
              : Response.json(REMOTE_MANIFEST),
        }),
      ),
    );
  });

  it.live("prefers a fetched manifest over the bundle and caches it to disk", () =>
    Effect.gen(function* () {
      const service = yield* make;
      const refreshed = yield* service.refresh;
      assert.deepStrictEqual(refreshed, REMOTE_MANIFEST);

      // A fresh service instance sees the disk cache without another fetch:
      // its HTTP layer is still stubbed, but `current` never fetches at all.
      const rebooted = yield* make;
      assert.deepStrictEqual(yield* rebooted.current, REMOTE_MANIFEST);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-fetch-test",
          response: () => Response.json(REMOTE_MANIFEST),
        }),
      ),
    ),
  );

  it.live("keeps the bundled manifest when the remote payload is malformed", () =>
    Effect.gen(function* () {
      const service = yield* make;
      assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-malformed-test",
          response: () => Response.json({ version: 999, nonsense: true }),
        }),
      ),
    ),
  );

  it.effect("preserves the last-good remote cache when later payloads are invalid", () => {
    let responseIndex = 0;
    const responses = [REMOTE_MANIFEST, ...INVALID_REMOTE_MANIFESTS];

    return Effect.gen(function* () {
      const service = yield* make;
      assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);

      for (const _invalid of INVALID_REMOTE_MANIFESTS) {
        yield* TestClock.adjust("1 hour");
        responseIndex += 1;
        assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
      }

      const rebooted = yield* make;
      assert.deepStrictEqual(yield* rebooted.current, REMOTE_MANIFEST);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-last-good-test",
          response: () => Response.json(responses[responseIndex]),
        }),
      ),
    );
  });

  it.live("drops a disk cache of a manifest older than the bundled one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const cachePath = path.join(config.stateDir, "model-manifest.json");
      // A cache of the manifest as it was before the release edited it. The
      // fetch time is irrelevant: the remote may be unreachable now, so
      // `current` must already prefer the bundle.
      const { updatedAt: _undated, ...undatedManifest } = REMOTE_MANIFEST;
      for (const stale of [
        undatedManifest,
        { ...REMOTE_MANIFEST, updatedAt: "2000-01-01T00:00:00Z" },
      ]) {
        yield* fs.writeFileString(
          cachePath,
          yield* encodeManifestCache({ fetchedAtMs: 0, manifest: stale }),
        );
        const service = yield* make;
        assert.deepStrictEqual(yield* service.current, BUNDLED_MODEL_MANIFEST);
      }

      // A cache of a newer edit still outranks the bundle.
      yield* fs.writeFileString(
        cachePath,
        yield* encodeManifestCache({ fetchedAtMs: 0, manifest: REMOTE_MANIFEST }),
      );
      const later = yield* make;
      assert.deepStrictEqual(yield* later.current, REMOTE_MANIFEST);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-newer-bundle-test",
          response: () => Response.json(REMOTE_MANIFEST),
        }),
      ),
    ),
  );

  it.live("does not fetch when provider update checks are disabled", () =>
    Effect.gen(function* () {
      let fetchCount = 0;
      const service = yield* make.pipe(
        Effect.provide(
          httpClientLayer(() => {
            fetchCount += 1;
            return Response.json(REMOTE_MANIFEST);
          }),
        ),
      );
      assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
      assert.deepStrictEqual(yield* service.forceRefresh, BUNDLED_MODEL_MANIFEST);
      assert.strictEqual(fetchCount, 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "model-manifest-optout-test",
          response: () => Response.json(REMOTE_MANIFEST),
          settings: { enableProviderUpdateChecks: false },
        }),
      ),
    ),
  );
});

it.effect("coalesces concurrent refreshes and retries offline only after the cooldown", () => {
  let calls = 0;
  return Effect.gen(function* () {
    const service = yield* make;
    yield* Effect.all([service.refresh, service.refresh, service.refresh], {
      concurrency: "unbounded",
    });
    assert.strictEqual(calls, 1);
    yield* TestClock.adjust("4 minutes");
    yield* service.refresh;
    assert.strictEqual(calls, 1);
    yield* TestClock.adjust("1 minute");
    assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
    assert.strictEqual(calls, 2);
    yield* TestClock.adjust("59 minutes");
    yield* service.refresh;
    assert.strictEqual(calls, 2);
    yield* TestClock.adjust("1 minute");
    yield* service.refresh;
    assert.strictEqual(calls, 3);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      serviceLayers({
        prefix: "claude-catalog-ttl-",
        response: () =>
          ++calls === 1 ? new Response(null, { status: 503 }) : Response.json(REMOTE_MANIFEST),
      }),
    ),
  );
});

it.live("never downgrades a newer cache from an older remote response", () => {
  let calls = 0;
  return Effect.gen(function* () {
    const service = yield* make;
    yield* service.refresh;
    assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
    assert.deepStrictEqual(yield* (yield* make).current, REMOTE_MANIFEST);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      serviceLayers({
        prefix: "claude-catalog-monotonic-",
        response: () => Response.json(calls++ === 0 ? REMOTE_MANIFEST : BUNDLED_MODEL_MANIFEST),
      }),
    ),
  );
});

it.effect("keeps current reads non-blocking while a fetch times out", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const service = yield* make.pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        ),
      ),
    );
    const pending = yield* service.refresh.pipe(Effect.forkScoped);
    yield* Deferred.await(started);
    assert.deepStrictEqual(yield* service.current, BUNDLED_MODEL_MANIFEST);
    yield* TestClock.adjust("11 seconds");
    assert.deepStrictEqual(yield* Fiber.join(pending), BUNDLED_MODEL_MANIFEST);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      serviceLayers({
        prefix: "claude-catalog-timeout-",
        response: () => Response.json(REMOTE_MANIFEST),
      }),
    ),
  ),
);

it.live(
  "reads the saved catalog with update checks disabled and ignores corrupt cache files",
  () => {
    let calls = 0;
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const cache = path.join(config.stateDir, "model-manifest.json");
      yield* fs.writeFileString(
        cache,
        yield* encodeManifestCache({ fetchedAtMs: 0, manifest: REMOTE_MANIFEST }),
      );
      const service = yield* make;
      assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
      yield* fs.writeFileString(cache, "invalid fixture");
      assert.deepStrictEqual(yield* (yield* make).current, BUNDLED_MODEL_MANIFEST);
      assert.strictEqual(calls, 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        serviceLayers({
          prefix: "claude-catalog-offline-",
          settings: { enableProviderUpdateChecks: false },
          response: () => {
            calls++;
            return Response.json(REMOTE_MANIFEST);
          },
        }),
      ),
    );
  },
);
