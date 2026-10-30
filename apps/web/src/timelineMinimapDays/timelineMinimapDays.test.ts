import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "../components/chat/MessagesTimeline.logic";
import { deriveTimelineMinimapItems } from "../components/chat/timelineMinimapItems";
import { groupTimelineMinimapItemsByDay, isTimelineMinimapTickInView } from "./timelineMinimapDays";

const NOW = new Date(2026, 9, 29, 12, 0);

// A user message at a local time and its reply a minute later.
const turn = (id: string, text: string, at: Date): MessagesTimelineRow[] =>
  (["user", "assistant"] as const).map(
    (role, index) =>
      ({
        kind: "message",
        id: `${id}:${role}`,
        createdAt: new Date(at.getTime() + index * 60_000).toISOString(),
        message: {
          id: `${id}:${role}`,
          role,
          text: role === "user" ? text : `Reply to ${text}`,
          runId: null,
          streaming: false,
          createdAt: new Date(at.getTime() + index * 60_000).toISOString(),
          updatedAt: new Date(at.getTime() + index * 60_000).toISOString(),
        },
        showAssistantMeta: false,
        showAssistantCopyButton: false,
        assistantCopyStreaming: false,
      }) as MessagesTimelineRow,
  );

const ticks = (rows: MessagesTimelineRow[]) =>
  groupTimelineMinimapItemsByDay(deriveTimelineMinimapItems(rows), rows, NOW);

describe("timeline minimap by day", () => {
  it("gives each local day one tick at its first message, with its count and first text", () => {
    const rows = [
      ...turn("a", "Check the build", new Date(2026, 9, 27, 9, 0)),
      ...turn("b", "Then the tests", new Date(2026, 9, 27, 18, 30)),
      ...turn("c", "Late question", new Date(2026, 9, 28, 23, 59)),
      ...turn("d", "Just after midnight", new Date(2026, 9, 29, 0, 1)),
      ...turn("e", "Lunch check", new Date(2026, 9, 29, 12, 0)),
      ...turn("f", "One more", new Date(2026, 9, 29, 12, 30)),
    ];
    expect(ticks(rows)).toEqual([
      {
        id: "a:user",
        rowIndex: 0,
        lastRowIndex: 3,
        userText: "Oct 27 · 2 messages",
        assistantText: "Check the build",
      },
      {
        id: "c:user",
        rowIndex: 4,
        lastRowIndex: 5,
        userText: "Oct 28 · 1 message",
        assistantText: "Late question",
      },
      {
        id: "d:user",
        rowIndex: 6,
        lastRowIndex: 11,
        userText: "Oct 29 · 3 messages",
        assistantText: "Just after midnight",
      },
    ]);
  });

  it("keeps a single day as one tick and names another year's day with its year", () => {
    expect(
      ticks([
        ...turn("a", "First", new Date(2026, 9, 29, 8, 0)),
        ...turn("b", "Second", new Date(2026, 9, 29, 9, 0)),
      ]).map((tick) => tick.userText),
    ).toEqual(["Oct 29 · 2 messages"]);
    expect(ticks(turn("a", "Old", new Date(2025, 11, 31, 22, 0)))[0]?.userText).toBe(
      "Dec 31, 2025 · 1 message",
    );
  });

  it("counts a day's tick in view while any of its rows is, a message's tick only for its own row", () => {
    const day = { id: "d", rowIndex: 4, lastRowIndex: 9, userText: null, assistantText: null };
    expect(isTimelineMinimapTickInView(day, 6, 8)).toBe(true);
    expect(isTimelineMinimapTickInView(day, 9, 12)).toBe(true);
    expect(isTimelineMinimapTickInView(day, 10, 12)).toBe(false);
    const message = { id: "m", rowIndex: 4, userText: null, assistantText: null };
    expect(isTimelineMinimapTickInView(message, 5, 8)).toBe(false);
    expect(isTimelineMinimapTickInView(message, 4, 8)).toBe(true);
  });
});
