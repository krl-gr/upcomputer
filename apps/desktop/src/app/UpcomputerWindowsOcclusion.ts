const NATIVE_WIN_OCCLUSION_FEATURE = "CalculateNativeWinOcclusion";

const featureNames = (value: string | null): ReadonlyArray<string> =>
  (value ?? "").split(",").flatMap((entry) => entry.trim().match(/^\*?([^<:]+)/)?.[1] ?? []);

/**
 * Windows marks a covered window, or every window while the display is off, as occluded and
 * stops drawing it, which starves the built-in browser tab an agent drives. Chromium keeps
 * only the last --disable-features value, so this returns the merged list to append.
 */
export function resolveWindowsDisableFeaturesSwitch(input: {
  readonly platform: NodeJS.Platform;
  readonly disableFeatures: string | null;
}): string | null {
  if (input.platform !== "win32") return null;
  if (featureNames(input.disableFeatures).includes(NATIVE_WIN_OCCLUSION_FEATURE)) return null;
  return input.disableFeatures === null
    ? NATIVE_WIN_OCCLUSION_FEATURE
    : `${input.disableFeatures},${NATIVE_WIN_OCCLUSION_FEATURE}`;
}
