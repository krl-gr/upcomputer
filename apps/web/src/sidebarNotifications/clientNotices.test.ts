import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { holdClientNotice, readClientNotices, type ClientNoticeInput } from "./clientNotices";

const input = (id: string, detail?: string): ClientNoticeInput => ({
  id,
  environmentId: EnvironmentId.make("env-1"),
  severity: "error",
  title: "Bots didn't load on {computer}",
  message: "The list shows what it had before.",
  ...(detail ? { detail } : {}),
});

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const held = (id: string) => readClientNotices().filter((notice) => notice.id === id);

describe("holdClientNotice", () => {
  it("keeps the first time while the problem lasts, and clears once every holder lets go", async () => {
    const times = ["2026-11-21T10:00:00.000Z", "2026-11-21T10:05:00.000Z"];
    const now = () => times.shift()!;
    const first = holdClientNotice(input("a", "first"), undefined, now);
    const second = holdClientNotice(input("a", "second"), undefined, now);
    expect(held("a")).toMatchObject([{ occurredAt: "2026-11-21T10:00:00.000Z", detail: "second" }]);
    first();
    await settle();
    expect(held("a")).toHaveLength(1);
    second();
    await settle();
    expect(held("a")).toHaveLength(0);
  });

  it("survives a release and a hold in the same task, as an effect running again does", async () => {
    let tick = 0;
    const now = () => `2026-11-21T10:0${tick++}:00.000Z`;
    const release = holdClientNotice(input("b"), undefined, now);
    release();
    const again = holdClientNotice(input("b"), undefined, now);
    await settle();
    expect(held("b")).toMatchObject([{ occurredAt: "2026-11-21T10:00:00.000Z" }]);
    again();
    await settle();
    // Cleared and seen again later: a new occurrence, which shows even if the first was dismissed.
    const later = holdClientNotice(input("b"), undefined, now);
    expect(held("b")).toMatchObject([{ occurredAt: "2026-11-21T10:01:00.000Z" }]);
    later();
  });
});
