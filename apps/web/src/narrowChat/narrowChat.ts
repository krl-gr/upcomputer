import "./narrowChat.css";

/**
 * Below this chat column width (CSS px, the chat canvas's own width, not the
 * window's) the chat drops its wide side gutters for one small one, the
 * phone layout's 0.75rem (`narrowChat.css`). At or above it nothing changes.
 */
export const NARROW_CHAT_MAX_WIDTH = 420;

/** Whether a chat canvas this wide uses the narrow gutter; 0 is not measured yet. */
export function isNarrowChat(canvasWidth: number): boolean {
  return canvasWidth > 0 && canvasWidth < NARROW_CHAT_MAX_WIDTH;
}
