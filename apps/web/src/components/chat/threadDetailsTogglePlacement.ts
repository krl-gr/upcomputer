/**
 * Where the chat view shows the thread details toggle: in our row under the
 * composer, in the header's panel controls, or over the header while an inline
 * right panel owns the title bar. `null` when the user turned thread details
 * off (`threadDetailsEnabled`); the card is then not rendered either.
 */
export type ThreadDetailsTogglePlacement = "composer-row" | "header" | "header-overlay";

export function resolveThreadDetailsTogglePlacement(input: {
  enabled: boolean;
  inComposerRow: boolean;
  rightPanelOwnsTitleBar: boolean;
}): ThreadDetailsTogglePlacement | null {
  if (!input.enabled) return null;
  if (input.inComposerRow) return "composer-row";
  return input.rightPanelOwnsTitleBar ? "header-overlay" : "header";
}
