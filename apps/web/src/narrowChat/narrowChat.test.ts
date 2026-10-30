import { describe, expect, it } from "vite-plus/test";

import { resolveChatCanvasLayout } from "../components/chat/chatCanvasLayout";
import { NARROW_CHAT_MAX_WIDTH, isNarrowChat } from "./narrowChat";

// The canvas layout's padding comes from the width probe: 12px when narrow, 48px from `sm` up.
const layoutAt = (width: number) =>
  resolveChatCanvasLayout({
    container: { width, height: 800 },
    preview: null,
    padding: isNarrowChat(width) ? 12 : 48,
  });

describe("narrow chat", () => {
  it.each([
    [0, false],
    [320, true],
    [NARROW_CHAT_MAX_WIDTH - 1, true],
    [NARROW_CHAT_MAX_WIDTH, false],
    [1024, false],
  ])("a %ipx canvas is narrow: %s", (width, narrow) => {
    expect(isNarrowChat(width)).toBe(narrow);
  });

  it("gives a narrow canvas one 12px gutter and keeps the layout from the breakpoint up", () => {
    expect(layoutAt(NARROW_CHAT_MAX_WIDTH - 1).chat).toEqual({
      left: 12,
      width: NARROW_CHAT_MAX_WIDTH - 1 - 24,
      insetStart: 0,
      insetEnd: 0,
    });
    expect(layoutAt(NARROW_CHAT_MAX_WIDTH).chat).toEqual({
      left: 48,
      width: NARROW_CHAT_MAX_WIDTH - 96,
      insetStart: 0,
      insetEnd: 0,
    });
    for (let width = 200; width <= 1400; width += 13) {
      const { chat } = layoutAt(width);
      expect(chat.insetStart).toBeGreaterThanOrEqual(0);
      expect(chat.insetEnd).toBeGreaterThanOrEqual(0);
    }
  });
});
