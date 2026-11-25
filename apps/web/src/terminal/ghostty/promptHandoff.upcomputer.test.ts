import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { GhosttyTerminalCore } from "./core";
import { PromptResizeHandoff } from "./promptHandoff";

vi.mock("./vendor/ghostty-vt.wasm?url", async () => ({
  default: (await import("./vendor/ghostty-vt.wasm?inline")).default,
}));
vi.mock("./vendor/ghostty-write-pty.wasm?url&no-inline", async () => ({
  default: (await import("./vendor/ghostty-write-pty.wasm?inline")).default,
}));

// Bytes recorded from zsh 5.9 started from the server's prompt-marks startup file.
const prompt = (text: string) =>
  `\r\x1b[0m\x1b[27m\x1b[24m\x1b[J\x1b]133;A\x07${text}\x1b]133;B\x07`;
const PS1 = "me@host ~/proj % ";

describe("PromptResizeHandoff", () => {
  const cores = new Set<GhosttyTerminalCore>();
  afterEach(() => {
    for (const core of cores) core.dispose();
    cores.clear();
  });

  it.each([
    {
      resize: "narrowing a one-line prompt",
      from: 21,
      to: 11,
      before: `${prompt(PS1)}\x1b[K`,
      redraw: `\r${prompt(PS1)}`,
      screen: ["out", "me@host ~/p", "roj %", "", "", ""],
    },
    {
      resize: "widening a two-line prompt",
      from: 11,
      to: 21,
      before: `${prompt("me@host ~/project/a\r\n% ")}\x1b[K`,
      redraw: `\r\x1b[A\x1b[A${prompt("me@host ~/project/a\r\n% ")}`,
      screen: ["out", "me@host ~/project/a", "%", "", "", ""],
    },
    {
      resize: "narrowing at a for> continuation prompt",
      from: 30,
      to: 12,
      before: `${prompt(PS1)}\x1b[K\x1b[?2004hf\x08for x in 1; d \r\x1b[Ko\x1b[?2004l\r\r\n${prompt("for> ")}\x1b[K\x1b[?2004h`,
      redraw: `\r${prompt("for> ")}`,
      screen: ["out", "me@host ~/pr", "oj % for x i", "n 1; do", "for>", ""],
    },
    {
      resize: "narrowing at a backslash continuation prompt",
      from: 30,
      to: 12,
      before: `${prompt(PS1)}\x1b[K\x1b[?2004he\x08echo a \\\x1b[?2004l\r\r\n${prompt("> ")}\x1b[K\x1b[?2004h`,
      redraw: `\r${prompt("> ")}`,
      screen: ["out", "me@host ~/pr", "oj % echo a", "\\", ">", ""],
    },
    {
      resize: "widening at a dquote> continuation prompt",
      from: 30,
      to: 40,
      before: `${prompt(PS1)}\x1b[K\x1b[?2004he\x08echo "open qu \r\x1b[Ko\rote\x1b[?2004l\r\r\n${prompt("dquote> ")}\x1b[K\x1b[?2004h`,
      redraw: `\r${prompt("dquote> ")}`,
      screen: ["out", 'me@host ~/proj % echo "open quote', "dquote>", "", "", ""],
    },
  ])("redraws zsh's prompt after $resize without stale copies or lost lines", async (input) => {
    const core = await GhosttyTerminalCore.create(
      input.from,
      6,
      8,
      16,
      {
        foreground: { r: 255, g: 255, b: 255 },
        background: { r: 0, g: 0, b: 0 },
        cursor: { r: 255, g: 255, b: 255 },
      },
      () => {},
    );
    cores.add(core);
    const handoff = new PromptResizeHandoff(core);
    core.write(`out\r\n${input.before}`);

    // The surface's order: reflow locally, hear the PTY's new width, then zsh's SIGWINCH redraw.
    handoff.beforeReflow(input.from);
    core.resize(input.to, 6, 8, 16);
    handoff.release(input.to);
    core.write(input.redraw);

    expect(
      core.snapshot().rowData.map((row) =>
        row.cells
          .map((cell) => cell.text || " ")
          .join("")
          .trimEnd(),
      ),
    ).toEqual(input.screen);
  });
});
