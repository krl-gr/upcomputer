import type { ProviderDriverKind, ServerProviderModel } from "@t3tools/contracts";

/**
 * UpComputer: a free Zen model the loaded catalog no longer lists is never sent; the server
 * swaps it for Zen's automatic choice (`servedZenModel` in provider-opencode). The composer
 * drops it too, so it shows and sends Automatic's model instead of an "Unavailable" one.
 */
export function isDroppedFreeZenModel(
  driverKind: ProviderDriverKind,
  slug: string | null | undefined,
  models: ReadonlyArray<ServerProviderModel>,
): boolean {
  return (
    driverKind === "opencode" &&
    slug?.startsWith("opencode/") === true &&
    slug.endsWith("-free") &&
    models.length > 0 &&
    !models.some((model) => model.slug === slug)
  );
}
