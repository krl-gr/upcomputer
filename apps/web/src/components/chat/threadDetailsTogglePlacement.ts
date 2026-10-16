/**
 * Where the chat view shows the thread details toggle: in the header's panel
 * controls, or over the header while an inline right panel owns the title bar.
 * `null` when the user turned thread details off (`threadDetailsEnabled`); the
 * card is then not rendered either.
 */
export type ThreadDetailsTogglePlacement = "header" | "header-overlay";

export function resolveThreadDetailsTogglePlacement(input: {
  enabled: boolean;
  rightPanelOwnsTitleBar: boolean;
}): ThreadDetailsTogglePlacement | null {
  if (!input.enabled) return null;
  return input.rightPanelOwnsTitleBar ? "header-overlay" : "header";
}
