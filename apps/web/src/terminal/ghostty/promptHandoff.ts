import type { GhosttyTerminalCore } from "./core";

const ROW_SEMANTIC_NONE = 0;
const ROW_SEMANTIC_PROMPT = 1;

type PromptCore = Pick<
  GhosttyTerminalCore,
  | "activeRowPrompt"
  | "cursorRow"
  | "freeTrackedRow"
  | "trackActiveRow"
  | "trackedActiveRow"
  | "write"
>;

/**
 * zsh redraws its prompt after SIGWINCH by moving up the rows it took at the old width,
 * so reflow leaves a cut-off copy (or erases output when widening). Remember the cursor's
 * distance below an OSC 133 prompt before reflow, then restore it on the reflowed prompt.
 */
interface PendingHandoff {
  /** Width the shell drew the prompt at. */
  readonly cols: number;
  /** Rows from the prompt's first row down to the cursor at that width. */
  readonly offset: number;
  /** Tracked reference to the prompt's first row. */
  readonly anchor: number;
}

export class PromptResizeHandoff {
  private pending: PendingHandoff | null = null;

  constructor(private readonly core: PromptCore) {}

  /** Call before resizing the grid away from `cols`, the width the shell last drew at. */
  beforeReflow(cols: number): void {
    if (this.pending) return;
    const cursorRow = this.core.cursorRow();
    const start = promptStart(this.core, cursorRow);
    if (start === null) return;
    this.pending = { cols, offset: cursorRow - start, anchor: this.core.trackActiveRow(start) };
  }

  /** Call when the shell learns the grid is now `cols` wide. Returns whether the screen changed. */
  release(cols: number): boolean {
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    const start = this.core.trackedActiveRow(pending.anchor);
    this.core.freeTrackedRow(pending.anchor);
    if (cols === pending.cols || start === null || this.core.cursorRow() < start) {
      return false;
    }
    // Line feeds rather than an absolute move, so a prompt near the bottom scrolls instead of clamping.
    this.core.write(`\x1b[${start + 1};1H\x1b[J${"\n".repeat(pending.offset)}`);
    return true;
  }

  /** Output since the reflow may have moved or replaced the prompt, so stop tracking it. */
  discard(): void {
    if (this.pending) this.core.freeTrackedRow(this.pending.anchor);
    this.pending = null;
  }
}

/** First active row of the OSC 133 prompt holding the cursor, or null in command output. */
function promptStart(core: PromptCore, cursorRow: number): number | null {
  for (let row = cursorRow; row >= 0; row -= 1) {
    const { semanticPrompt, isWrapContinuation } = core.activeRowPrompt(row);
    if (isWrapContinuation) continue;
    if (semanticPrompt === ROW_SEMANTIC_PROMPT) return row;
    if (semanticPrompt === ROW_SEMANTIC_NONE) return null;
  }
  return null;
}
