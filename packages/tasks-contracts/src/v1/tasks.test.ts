import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { assert, test } from "vite-plus/test";

import { TaskArchiveInput, TaskSearchInput, TaskUpdateInput } from "./tasks.ts";

const decodeArchive = Schema.decodeUnknownResult(TaskArchiveInput);
const decodeSearch = Schema.decodeUnknownResult(TaskSearchInput);
const decodeUpdate = Schema.decodeUnknownSync(TaskUpdateInput);
const validArchive = (input: unknown) => Result.isSuccess(decodeArchive(input));
const validSearch = (input: unknown) => Result.isSuccess(decodeSearch(input));

test("archive takes 1 to 500 ids and an optional reason", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `task-${index}`);
  assert.ok(validArchive({ ids: ids(1) }));
  assert.ok(validArchive({ ids: ids(500), reason: "cleanup" }));
  assert.ok(!validArchive({ ids: [] }));
  assert.ok(!validArchive({ ids: ids(501) }));
});

test("search accepts only the three archive modes", () => {
  for (const archive of ["active", "archived", "all"]) assert.ok(validSearch({ archive }));
  assert.ok(!validSearch({ archive: "closed" }));
});

test("a task update cannot archive: closedAt is no longer part of it", () => {
  const result = decodeUpdate({
    id: "task-1",
    closedAt: "2026-10-07T10:00:00.000Z",
  });
  assert.deepEqual(Object.keys(result), ["id"]);
});
