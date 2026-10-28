import { describe, expect, it } from "vite-plus/test";
import { resolveChatCanvasLayout, type ChatCanvasPreview } from "./chatCanvasLayout";

const preview: ChatCanvasPreview = {
  key: "browser:one",
  width: 320,
  position: null,
  source: { width: 1600, height: 1000 },
};
const resolve = (width: number, player: ChatCanvasPreview | null = preview, height = 900) =>
  resolveChatCanvasLayout({ container: { width, height }, preview: player, composerHeight: 180 });
const expectClear = (result: ReturnType<typeof resolve>) => {
  const frame = result.frame!;
  const chat = result.chat;
  expect(frame.x + frame.width <= chat.left - 12 || frame.x >= chat.left + chat.width + 12).toBe(
    true,
  );
};

describe("chat canvas layout", () => {
  it("lifts a growing preview above the composer without snapping at the chat boundary", () => {
    let previous: ReturnType<typeof resolve> | undefined;
    for (let width = 480; width <= 1100; width++) {
      const result = resolve(1344, {
        ...preview,
        width,
        lastInteraction: "resize",
        position: { x: 1332 - width, y: 888 - Math.round(width / 1.6) },
      });
      const frame = result.frame!;
      if (frame.x < result.chat.left + result.chat.width + 12) {
        expect(frame.y + frame.height).toBeLessThanOrEqual(708);
      }
      expect(result.chat.left).toBeLessThanOrEqual(288);
      expect(result.chat.width).toBeGreaterThanOrEqual(640);
      if (previous) {
        expect(Math.abs(frame.y - previous.frame!.y)).toBeLessThanOrEqual(3);
        expect(Math.abs(frame.width - previous.frame!.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(result.chat.width - previous.chat.width)).toBeLessThanOrEqual(1);
      }
      previous = result;
    }
    expect(previous!.overlapsChat).toBe(true);
    expect(previous!.frame!.width).toBe(1100);
  });
  it.each([900, 1000, 1004])("allows dragging across a %spx chat canvas", (width) => {
    const start = resolve(width, { ...preview, position: { x: width - 332, y: 200 } }).frame!;
    const moved = resolve(width, {
      ...preview,
      position: { x: start.x - 300, y: start.y },
      lastInteraction: "drag",
    });
    expect(moved.frame).toEqual({ ...start, x: start.x - 300 });
    const returned = resolve(width, {
      ...preview,
      position: { x: start.x, y: start.y },
      lastInteraction: "drag",
    });
    expect(returned.frame).toEqual(start);
  });
  it("stops leftward dragging before the player can push chat to the right", () => {
    const centered = resolve(1344, null).chat;
    for (const x of [1100, 800, 700, 600, 400, 12, -100]) {
      const result = resolve(1344, { ...preview, position: { x, y: 500 } });
      expect(result.frame!.x).toBeGreaterThanOrEqual(700);
      expect(result.chat.left).toBeLessThanOrEqual(centered.left);
      expect(result.chat.insetStart).toBe(0);
      expect(result.chat.width).toBeGreaterThanOrEqual(640);
      expectClear(result);
    }
    expect(resolve(1344, { ...preview, position: { x: 12, y: 500 } }).frame!.x).toBe(700);
  });
  it("keeps a dragged player above the composer when no readable lane fits beside it", () => {
    const result = resolve(1000, { ...preview, position: { x: 12, y: 700 } });
    expect(result.chat).toEqual(resolve(1000, null).chat);
    expect(result.frame!.x).toBe(12);
    expect(result.frame!.y + result.frame!.height).toBeLessThanOrEqual(708);
  });
  it("restores the preferred width when the container grows again", () => {
    const player = { ...preview, width: 480 };
    expect(resolve(1200, player).chat.width).toBeLessThan(768);
    expect(resolve(1800, player).chat.width).toBe(768);
    expect(player.width).toBe(480);
  });
  it("uses the same stable side-by-side frame even as the composer grows", () => {
    const result = resolve(1344);
    expect(
      resolveChatCanvasLayout({
        container: { width: 1344, height: 900 },
        preview,
        composerHeight: 400,
      }),
    ).toEqual(result);
  });
  it("keeps a dragged or resized preview below the open find bar", () => {
    const findBar = { left: 1292, right: 1572, bottom: 48 };
    const layout = (lastInteraction: "drag" | "resize") =>
      resolveChatCanvasLayout({
        container: { width: 1584, height: 988 },
        maxChatWidth: 736,
        composerHeight: 180,
        findBar,
        preview: {
          ...preview,
          width: 240,
          source: { width: 240, height: 365 },
          position: { x: 1332, y: 12 },
          lastInteraction,
        },
      });
    for (const lastInteraction of ["drag", "resize"] as const) {
      const result = layout(lastInteraction);
      expect(result.frame).toEqual({ x: 1332, y: 60, width: 240, height: 365 });
      expect(result.chat).toEqual({ left: 424, width: 736, insetStart: 0, insetEnd: 0 });
    }
  });
  it("keeps a dragged preview clear of the open find bar", () => {
    const result = resolveChatCanvasLayout({
      container: { width: 1800, height: 1000 },
      findBar: { left: 1362, right: 1782, bottom: 72 },
      preview: {
        ...preview,
        width: 240,
        source: { width: 240, height: 365 },
        position: { x: 1200, y: 12 },
        lastInteraction: "drag",
      },
    });
    const frame = result.frame!;
    expect(frame.x + frame.width <= 1362 || frame.y >= 84).toBe(true);
  });
});
