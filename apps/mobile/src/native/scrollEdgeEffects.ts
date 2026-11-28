// Avoid RN/navigation imports so node checks do not load their untranspiled Flow.

export type NativeTopScrollEdgeEffect = "automatic" | "soft";
export type NativeHeaderScrollEdgeEffects = {
  readonly top: NativeTopScrollEdgeEffect;
  readonly bottom: "hidden";
  readonly left: "hidden";
  readonly right: "hidden";
};

function nativeTopScrollEdgeEffect(
  os: string,
  _version: number | string,
): NativeTopScrollEdgeEffect {
  if (os !== "ios") {
    return "automatic";
  }

  // Headers draw no background, so content fades softly under the glass items, never a hard bar.
  return "soft";
}

export function nativeHeaderScrollEdgeEffects(
  os: string,
  version: number | string,
): NativeHeaderScrollEdgeEffects {
  return {
    top: nativeTopScrollEdgeEffect(os, version),
    bottom: "hidden",
    left: "hidden",
    right: "hidden",
  };
}
