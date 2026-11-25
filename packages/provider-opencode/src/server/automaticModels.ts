import type { OpencodeClient, ProviderListResponse } from "@opencode-ai/sdk/v2";
import * as Effect from "effect/Effect";

import {
  parseOpenCodeModelSlug,
  runOpenCodeSdk,
  type ParsedOpenCodeModelSlug,
} from "./OpenCodeRuntime.ts";

export const ZEN_PROVIDER_ID = "opencode";
// UpComputer: Zen's free models that keep no data, preferred in this order.
const ZEN_AUTOMATIC_MODELS: ReadonlyArray<string> = [
  "opencode/glm-5.3-flash-free",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/minimax-m3.1-flash-free",
];
// Free while its team collects feedback on it, so only a user's own choice or the last resort.
export const ZEN_NEVER_AUTOMATIC = "opencode/big-pickle";

/** A Zen catalog entry; live means listed and neither deprecated nor superseded. */
export interface ZenModel {
  readonly slug: string;
  readonly free: boolean;
  readonly live: boolean;
}

type ZenCost = { readonly input: number; readonly output: number };

/** Free by its `-free` id or by a zero price in every tier it lists. */
export function isFreeZenModel(id: string, cost?: ZenCost | ReadonlyArray<ZenCost>): boolean {
  if (id.endsWith("-free")) return true;
  const tiers = cost === undefined ? [] : "input" in cost ? [cost] : cost;
  return tiers.length > 0 && tiers.every((tier) => tier.input === 0 && tier.output === 0);
}

/**
 * UpComputer: Zen's "Automatic". Zen drops and renames free models without notice, so the
 * preferred list only orders the choice: then any live free model, then OpenCode's own
 * default for Zen. A paid model is never automatic, since a new user has no Zen key.
 */
export function automaticZenModel(
  models: ReadonlyArray<ZenModel>,
  zenDefault: string | undefined,
): string | undefined {
  const live = models.filter((model) => model.live);
  const liveSlugs = new Set(live.map((model) => model.slug));
  return (
    ZEN_AUTOMATIC_MODELS.find((slug) => liveSlugs.has(slug)) ??
    live
      .filter((model) => model.free && model.slug !== ZEN_NEVER_AUTOMATIC)
      .map((model) => model.slug)
      .toSorted()[0] ??
    models.find(
      (model) => model.slug === zenDefault && (model.free || model.slug === ZEN_NEVER_AUTOMATIC),
    )?.slug
  );
}

// A selection "Automatic" may have made; one the user picked from Zen's free models too.
const takesStandIn = (slug: string) =>
  ZEN_AUTOMATIC_MODELS.includes(slug) ||
  (slug.startsWith(`${ZEN_PROVIDER_ID}/`) && slug.endsWith("-free"));

/** The model to send: the selection while it is live, else Zen's automatic choice. */
export function servedZenModel(
  slug: string,
  models: ReadonlyArray<ZenModel>,
  zenDefault: string | undefined,
): string {
  if (!takesStandIn(slug) || models.some((model) => model.slug === slug && model.live)) {
    return slug;
  }
  return automaticZenModel(models, zenDefault) ?? slug;
}

export function zenModelsOf(list: Pick<ProviderListResponse, "all">): ReadonlyArray<ZenModel> {
  const zen = list.all.find((provider) => provider.id === ZEN_PROVIDER_ID);
  return Object.values(zen?.models ?? {}).map((model) => ({
    slug: `${ZEN_PROVIDER_ID}/${model.id}`,
    free: isFreeZenModel(model.id, model.cost),
    live: model.status !== "deprecated",
  }));
}

/** Per session: each selection's model to send, so the catalog is read once. */
export type ServedModelCache = Map<string, string>;

/**
 * The model to prompt with. A free Zen selection this server no longer serves gives way to
 * Zen's automatic choice; a failed catalog read keeps the selection and is not cached.
 */
export const resolveOpenCodeServedModel = Effect.fnUntraced(function* (
  client: OpencodeClient,
  model: ParsedOpenCodeModelSlug,
  cache: ServedModelCache = new Map(),
  abortSignal?: AbortSignal,
) {
  const slug = `${model.providerID}/${model.modelID}`;
  if (!takesStandIn(slug)) return model;
  let served = cache.get(slug);
  if (served === undefined) {
    const list = yield* runOpenCodeSdk("provider.list", (signal) =>
      client.provider.list(undefined, {
        signal: abortSignal ? AbortSignal.any([signal, abortSignal]) : signal,
      }),
    ).pipe(
      Effect.timeout("10 seconds"),
      Effect.map((response) => response.data),
      Effect.orElseSucceed(() => undefined),
    );
    if (list === undefined) return model;
    served = servedZenModel(slug, zenModelsOf(list), zenDefaultOf(list.default));
    cache.set(slug, served);
  }
  return served === slug ? model : (parseOpenCodeModelSlug(served) ?? model);
});

export const zenDefaultOf = (defaults: Readonly<Record<string, string>> | undefined) =>
  defaults?.[ZEN_PROVIDER_ID] === undefined
    ? undefined
    : `${ZEN_PROVIDER_ID}/${defaults[ZEN_PROVIDER_ID]}`;
