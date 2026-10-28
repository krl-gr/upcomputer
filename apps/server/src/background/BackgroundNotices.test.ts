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

it.effect("evicts info before warnings before errors", () =>
  Effect.gen(function* () {
    const notices = yield* BackgroundNotices.BackgroundNotices;
    yield* notices.report({ ...notice("error"), severity: "error", title: "Schedule stopped" });
    yield* notices.report({ ...notice("warning"), title: "Worktrees" });
    for (let index = 0; index < 60; index++) {
      yield* notices.report({ ...notice(`warning-${index}`), title: `Warning ${index}` });
    }
    const listed = yield* notices.list;
    assert.strictEqual(listed.length, 50);
    assert.isTrue(listed.some(({ id }) => id === "error"));
    assert.isFalse(listed.some(({ id }) => id === "warning"));

    for (let index = 0; index < 60; index++) {
      yield* notices.report({
        ...notice(`info-${index}`),
        severity: "info",
        title: `Info ${index}`,
      });
    }
    const afterInfo = yield* notices.list;
    assert.isTrue(afterInfo.some(({ id }) => id === "error"));
    assert.strictEqual(afterInfo.filter(({ severity }) => severity === "warning").length, 49);
  }).pipe(Effect.provide(BackgroundNotices.layer)),
);

it.effect("folds repeated info notices of one kind into one entry", () =>
  Effect.gen(function* () {
    const notices = yield* BackgroundNotices.BackgroundNotices;
    const missed = (id: string) =>
      ({
        id,
        area: "reminders",
        severity: "info",
        title: "Missed reminder",
        message: `You missed ${id}.`,
      }) as const;
    yield* notices.report(missed("a"));
    yield* notices.report(missed("b"));
    yield* notices.report(missed("c"));
    assert.deepStrictEqual(
      (yield* notices.list).map(({ id, message }) => [id, message]),
      [["c", "You missed c. 2 more like this."]],
    );
    yield* notices.resolve("c");
    assert.deepStrictEqual(
      (yield* notices.list).map(({ id, message }) => [id, message]),
      [["b", "You missed b. 1 more like this."]],
    );
  }).pipe(Effect.provide(BackgroundNotices.layer)),
);
