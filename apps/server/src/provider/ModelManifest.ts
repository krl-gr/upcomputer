/**
 * Claude catalog backport from upstream T3 Code (see docs/internals/claude-model-catalog.md).
 * Only public model metadata is fetched; no credentials, sessions, provider
 * compatibility policies, or other providers' discovery are imported.
 * Startup uses disk/bundled data. Newer valid remote data is cached atomically;
 * failed or older responses never replace the last usable catalog.
 */
import {
  ModelCapabilities,
  TrimmedNonEmptyString,
  type ProviderDriverKind,
  type ServerProviderModel,
} from "@upcomputer/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { hasValidClaudeManifestAdapters } from "./ClaudeModelManifest.ts";
import bundledManifestJson from "./model-manifest.json" with { type: "json" };

const MODEL_MANIFEST_URL =
  "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json";

/** How long a fetched manifest stays fresh before the next probe re-fetches. */
const MANIFEST_TTL_MS = 60 * 60 * 1000;

/** Minimum gap between fetch attempts after a failure, so an offline server
 * does not pay a network timeout on every provider check. */
const MANIFEST_RETRY_MS = 5 * 60 * 1000;

const FETCH_TIMEOUT_MS = 10_000;

const ManifestModelStatus = Schema.Literals(["current", "legacy"]);

const ManifestModelProfile = Schema.Struct({
  capabilities: Schema.optional(ModelCapabilities),
  adapter: Schema.optional(Schema.Unknown),
});

const ManifestProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  shortName: Schema.optional(TrimmedNonEmptyString),
  subProvider: Schema.optional(TrimmedNonEmptyString),
  aliases: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  status: ManifestModelStatus,
  badge: Schema.optional(Schema.Literal("new")),
  profile: Schema.optional(TrimmedNonEmptyString),
  adapter: Schema.optional(Schema.Unknown),
});

const ManifestProviderCatalog = Schema.Struct({
  defaults: Schema.optional(
    Schema.Struct({
      chat: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
  profiles: Schema.Record(Schema.String, ManifestModelProfile),
  models: Schema.Array(ManifestProviderModel).check(Schema.isMinLength(1)),
});

/**
 * `version` gates breaking schema changes. Provider catalogs are additive so
 * clients that only understand `currentModels` keep accepting this v1 file.
 */
const ModelManifestEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  /**
   * ISO date of the last edit. A release bundles its manifest, and a disk
   * cache of an older edit must not outrank it. Optional so older remote
   * files still decode; they count as older than any dated bundle.
   */
  updatedAt: Schema.optional(Schema.String),
  currentModels: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  providers: Schema.Struct({ claudeAgent: ManifestProviderCatalog }),
});

const hasValidProviderCatalogReferences = (
  manifest: typeof ModelManifestEnvelopeSchema.Type,
): boolean =>
  Object.values(manifest.providers ?? {}).every((catalog) => {
    const slugs = new Set<string>();
    const modelsAreValid = catalog.models.every((model) => {
      if (slugs.has(model.slug)) return false;
      slugs.add(model.slug);
      return model.profile === undefined || catalog.profiles[model.profile] !== undefined;
    });
    return (
      modelsAreValid && (catalog.defaults?.chat === undefined || slugs.has(catalog.defaults.chat))
    );
  });

const ModelManifestSchema = ModelManifestEnvelopeSchema.pipe(
  Schema.check(
    Schema.makeFilter(hasValidProviderCatalogReferences, {
      expected: "unique model slugs and existing model and profile references",
    }),
    Schema.makeFilter(hasValidClaudeManifestAdapters, {
      expected: "valid Claude adapter metadata",
    }),
  ),
);
export type ModelManifestData = typeof ModelManifestSchema.Type;

export interface ResolvedManifestModel {
  readonly model: ServerProviderModel;
  readonly aliases: ReadonlyArray<string>;
  readonly adapter: unknown;
  readonly profileAdapter: unknown;
}

export interface ResolvedProviderCatalog {
  readonly models: ReadonlyArray<ResolvedManifestModel>;
  readonly defaults: {
    readonly chat: string | undefined;
  };
}

const decodeManifest = Schema.decodeUnknownEffect(ModelManifestSchema);

export const BUNDLED_MODEL_MANIFEST: ModelManifestData =
  Schema.decodeUnknownSync(ModelManifestSchema)(bundledManifestJson);

/** Epoch millis of the manifest's `updatedAt`, or 0 when absent or unparsable. */
function manifestUpdatedAtMs(manifest: ModelManifestData): number {
  if (manifest.updatedAt === undefined) return 0;
  const parsed = Date.parse(manifest.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Resolve provider-neutral model presentation and capability data. */
export function resolveProviderCatalog(
  manifest: ModelManifestData,
  driverKind: ProviderDriverKind,
): ResolvedProviderCatalog | null {
  const catalog = driverKind === "claudeAgent" ? manifest.providers.claudeAgent : undefined;
  if (!catalog) return null;

  const seen = new Set<string>();
  const models: Array<ResolvedManifestModel> = [];
  for (const entry of catalog.models) {
    if (seen.has(entry.slug)) return null;
    seen.add(entry.slug);

    const profile = entry.profile ? catalog.profiles[entry.profile] : undefined;
    if (entry.profile && !profile) return null;

    models.push({
      model: {
        slug: entry.slug,
        name: entry.status === "legacy" ? `${entry.name} (Legacy)` : entry.name,
        ...(entry.shortName ? { shortName: entry.shortName } : {}),
        ...(entry.subProvider ? { subProvider: entry.subProvider } : {}),
        isCustom: false,
        ...(catalog.defaults?.chat === entry.slug ? { isDefault: true } : {}),
        capabilities: profile?.capabilities ?? null,
      },
      aliases: entry.aliases ?? [],
      adapter: entry.adapter,
      profileAdapter: profile?.adapter,
    });
  }

  if (catalog.defaults?.chat !== undefined && !seen.has(catalog.defaults.chat)) return null;

  return {
    models,
    defaults: {
      chat: catalog.defaults?.chat,
    },
  };
}

/** On-disk shape of the last successfully fetched manifest. */
const ManifestCacheFile = Schema.Struct({
  fetchedAtMs: Schema.Number,
  manifest: ModelManifestSchema,
});
const decodeManifestCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    ManifestCacheFile as unknown as Schema.Codec<typeof ManifestCacheFile.Type>,
  ),
);
/** Exported for tests that seed the disk cache. */
export const encodeManifestCache = Schema.encodeEffect(
  Schema.fromJsonString(
    ManifestCacheFile as unknown as Schema.Codec<typeof ManifestCacheFile.Type>,
  ),
);

export class ModelManifest extends Context.Service<
  ModelManifest,
  {
    /** Manifest already in memory (disk cache or bundle); never fetches.
     * Snapshot classification reads this, so it never waits on the network. */
    readonly current: Effect.Effect<ModelManifestData>;
    /** Manifest after a TTL-gated remote refresh; never fails. */
    readonly refresh: Effect.Effect<ModelManifestData>;
    /** Explicit refresh bypasses freshness and retry timers, retaining last-good data. */
    readonly forceRefresh: Effect.Effect<ModelManifestData>;
    /** Forks `refresh` into the service's own scope. Drivers call this from
     * provider checks: the fetch is process-shared state, so it must survive
     * the teardown of whichever instance happened to trigger it. */
    readonly refreshInBackground: Effect.Effect<void>;
  }
>()("@upcomputer/server/provider/ModelManifest") {}

/** Constant service backing the bundled-data test layer. */
const BundledOnlyModelManifest: ModelManifest["Service"] = {
  current: Effect.succeed(BUNDLED_MODEL_MANIFEST),
  refresh: Effect.succeed(BUNDLED_MODEL_MANIFEST),
  forceRefresh: Effect.succeed(BUNDLED_MODEL_MANIFEST),
  refreshInBackground: Effect.void,
};

export const layerTest = Layer.succeed(ModelManifest, BundledOnlyModelManifest);

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const serviceScope = yield* Effect.scope;

  const cachePath = path.join(config.stateDir, "model-manifest.json");
  let manifest = BUNDLED_MODEL_MANIFEST;
  let fetchedAtMs: number | null = null;
  let lastAttemptMs: number | null = null;
  const refreshSemaphore = yield* Semaphore.make(1);

  // `Effect.cached` makes concurrent first readers await the same disk load
  // rather than racing a "loaded" flag. Only `refreshed` takes the fetch
  // semaphore; `current` must never wait behind an in-flight network refresh.
  const ensureDiskCacheLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const fromDisk = yield* fileSystem.readFileString(cachePath).pipe(
        Effect.flatMap((raw) => decodeManifestCache(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (fromDisk === null) return;
      // The disk copy is the last-seen remote manifest, so it outranks the
      // bundle even when stale, unless the bundle's own edit date is newer
      // than the cached manifest's. Then the release carries data the cache
      // has not seen and the cache is dropped so the next refresh replaces
      // it. Comparing edit dates, not fetch time, keeps this independent of
      // when the cache was written relative to the release.
      if (manifestUpdatedAtMs(BUNDLED_MODEL_MANIFEST) > manifestUpdatedAtMs(fromDisk.manifest)) {
        return;
      }
      manifest = fromDisk.manifest;
      fetchedAtMs = fromDisk.fetchedAtMs;
    }),
  );

  const refresh = Effect.fn("ModelManifest.refresh")(function* (force = false) {
    yield* ensureDiskCacheLoaded;
    const now = yield* Clock.currentTimeMillis;
    // A timestamp in the future means the wall clock moved backwards (the
    // disk cache crosses restarts, so monotonic time cannot cover it). Treat
    // it as expired: the refetch rewrites both timestamps and self-heals.
    const isWithin = (sinceMs: number | null, windowMs: number) =>
      sinceMs !== null && now >= sinceMs && now - sinceMs < windowMs;
    if (!force && isWithin(fetchedAtMs, MANIFEST_TTL_MS)) return manifest;
    if (!force && isWithin(lastAttemptMs, MANIFEST_RETRY_MS)) return manifest;

    // The same switch that gates provider CLI update checks. It stops network
    // fetches only: a manifest already cached on disk from an earlier fetch
    // stays in effect, since the setting is about phoning home, not about
    // discarding data the server already holds.
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (settings === null || !settings.enableProviderUpdateChecks) return manifest;

    lastAttemptMs = now;
    const fetched = yield* httpClient.get(MODEL_MANIFEST_URL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.flatMap((json) => decodeManifest(json)),
      Effect.timeout(FETCH_TIMEOUT_MS),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (fetched === null) return manifest;

    // A stale remote response must not downgrade a newer bundle or cache.
    if (manifestUpdatedAtMs(fetched) < manifestUpdatedAtMs(manifest)) return manifest;
    manifest = fetched;
    fetchedAtMs = now;
    yield* encodeManifestCache({ fetchedAtMs: now, manifest: fetched }).pipe(
      Effect.flatMap((serialized) =>
        Effect.gen(function* () {
          const temporary = `${cachePath}.tmp`;
          yield* fileSystem.writeFileString(temporary, serialized);
          yield* fileSystem.rename(temporary, cachePath);
        }),
      ),
      Effect.catchCause(() => Effect.void),
    );
    return manifest;
  });

  const guardedRefresh = refreshSemaphore.withPermits(1)(refresh());

  return ModelManifest.of({
    current: ensureDiskCacheLoaded.pipe(Effect.map(() => manifest)),
    refresh: guardedRefresh,
    forceRefresh: refreshSemaphore.withPermits(1)(refresh(true)),
    refreshInBackground: Effect.forkIn(guardedRefresh, serviceScope).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(ModelManifest, make);
