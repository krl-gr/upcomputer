// UpComputer: Zen's free models that keep no data, in the first-run order.
export const ZEN_AUTOMATIC_MODELS: ReadonlyArray<string> = [
  "opencode/glm-5.3-flash-free",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/minimax-m3.1-flash-free",
];

/**
 * Zen drops free models without notice, and a stale catalog can still name one as
 * "Automatic". The other automatic models, in order, stand in for it. A model the
 * user picked outside this list has none, so their choice stays and fails plainly.
 */
export function automaticModelStandIns(slug: string): ReadonlyArray<string> {
  return ZEN_AUTOMATIC_MODELS.includes(slug)
    ? ZEN_AUTOMATIC_MODELS.filter((candidate) => candidate !== slug)
    : [];
}

/** The model to send: the selection, or its first stand-in the server still serves. */
export function servedAutomaticModel(
  slug: string,
  isServed: (slug: string) => boolean | undefined,
): string {
  if (isServed(slug) !== false) return slug;
  return automaticModelStandIns(slug).find((candidate) => isServed(candidate) === true) ?? slug;
}
