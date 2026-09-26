import { ProjectId } from "@upcomputer/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getLatestThreadForProject, sortThreads, type ThreadSortInput } from "./threadSort.ts";

type TestThread = { readonly id: string } & ThreadSortInput;

function makeThread(overrides: Partial<TestThread> = {}): TestThread {
  return {
    id: "thread-1",
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    messages: [],
    latestUserMessageAt: null,
    ...overrides,
  };
}

describe("sortThreads", () => {
  it.each(["created_at", "updated_at"] as const)(
    "preserves references, input order and descending id ties for %s",
    (sortOrder) => {
      const threads = Object.freeze([
        makeThread({ id: "a" }),
        makeThread({ id: "z" }),
        makeThread({ id: "invalid-a", createdAt: "invalid", updatedAt: "invalid" }),
        makeThread({ id: "invalid-z", createdAt: "invalid", updatedAt: "invalid" }),
      ]);
      const sorted = sortThreads(threads, sortOrder);
      expect(sorted).toEqual([threads[1], threads[0], threads[3], threads[2]]);
      expect(sorted[0]).toBe(threads[1]);
      expect(threads[0]?.id).toBe("a");
    },
  );

  it("falls back to updatedAt and createdAt when latestUserMessageAt is invalid and there are no messages", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: "thread-1",
          latestUserMessageAt: "not-a-date",
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
        makeThread({
          id: "thread-2",
          latestUserMessageAt: "still-not-a-date",
          createdAt: "invalid-created-at",
          updatedAt: "invalid-updated-at",
        }),
        makeThread({
          id: "thread-3",
          latestUserMessageAt: "invalid-latest-user-message-at",
          createdAt: "2026-03-09T10:06:00.000Z",
          updatedAt: "invalid-updated-at",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual(["thread-3", "thread-1", "thread-2"]);
  });

  it("falls back to the latest valid user message when latestUserMessageAt is invalid", () => {
    const sorted = sortThreads(
      [
        makeThread({
          id: "thread-1",
          latestUserMessageAt: "invalid-latest-user-message-at",
          updatedAt: "2026-03-09T10:00:00.000Z",
          messages: [
            { role: "user", createdAt: "2026-03-09T10:05:00.000Z" },
            { role: "assistant", createdAt: "2026-03-09T10:30:00.000Z" },
            { role: "user", createdAt: "2026-03-09T10:20:00.000Z" },
          ],
        }),
        makeThread({
          id: "thread-2",
          createdAt: "2026-03-09T10:15:00.000Z",
          updatedAt: "2026-03-09T10:15:00.000Z",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual(["thread-1", "thread-2"]);
  });
});

describe("getLatestThreadForProject", () => {
  it.each(["created_at", "updated_at"] as const)(
    "matches the first sorted eligible thread for %s",
    (sortOrder) => {
      const projectId = ProjectId.make("project");
      const threads = [
        { ...makeThread({ id: "a" }), projectId, archivedAt: null },
        { ...makeThread({ id: "z" }), projectId, archivedAt: null },
        { ...makeThread({ id: "zz" }), projectId, archivedAt: "2026-03-10T00:00:00Z" },
        { ...makeThread({ id: "zzz" }), projectId: ProjectId.make("other"), archivedAt: null },
      ];
      expect(getLatestThreadForProject(threads, projectId, sortOrder)).toBe(threads[1]);
      expect(getLatestThreadForProject([], projectId, sortOrder)).toBeNull();
      expect(getLatestThreadForProject(threads, ProjectId.make("missing"), sortOrder)).toBeNull();
      const invalid = threads.slice(0, 2).map((thread) => ({
        ...thread,
        createdAt: "invalid",
        updatedAt: "invalid",
      }));
      expect(getLatestThreadForProject(invalid, projectId, sortOrder)).toBe(invalid[1]);
      expect(
        getLatestThreadForProject([threads[1]!, { ...threads[1]! }], projectId, sortOrder),
      ).toBe(threads[1]);
    },
  );
});
