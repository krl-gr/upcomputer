import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as BackgroundNotices from "./BackgroundNotices.ts";

const notice = (id: string, message = "Something needs attention.") =>
  ({ id, area: "reminders", severity: "warning", title: "Reminders", message }) as const;

it.effect("keeps one notice per problem, newest first, until it is resolved", () =>
  Effect.gen(function* () {
    const notices = yield* BackgroundNotices.BackgroundNotices;
    yield* notices.report(notice("a"));
    yield* notices.report(notice("b"));
    yield* notices.report(notice("a", "It happened again."));
    const listed = yield* notices.list;
    assert.deepStrictEqual(
      listed.map(({ id, message }) => [id, message]),
      [
        ["a", "It happened again."],
        ["b", "Something needs attention."],
      ],
    );
    yield* notices.resolve("a");
    assert.deepStrictEqual(
      (yield* notices.list).map(({ id }) => id),
      ["b"],
    );
  }).pipe(Effect.provide(BackgroundNotices.layer)),
);
