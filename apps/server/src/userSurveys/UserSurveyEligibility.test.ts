import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  activityQualifies,
  readUserMessageActivity,
  surveyBuildAllowed,
  surveyNotHandled,
} from "./UserSurveyEligibility.ts";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;

/** Inserts messages as the projection stores them; only these columns are read. */
const insertMessages = (
  messages: ReadonlyArray<{
    readonly at: string;
    readonly role?: "user" | "assistant";
    readonly createdBy?: "user" | "agent" | "system";
    readonly creationSource?: "web" | "mobile" | "mcp" | "provider" | "server";
  }>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const [index, message] of messages.entries()) {
      const payload = JSON.stringify({
        createdBy: message.createdBy ?? "user",
        creationSource: message.creationSource ?? "web",
      });
      yield* sql`
        INSERT INTO orchestration_v2_projection_messages
          (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
        VALUES (${`message-${index}`}, 'thread-1', NULL, NULL, ${message.role ?? "user"}, 0,
          ${message.at}, ${message.at}, ${payload})
      `;
    }
  });

describe("readUserMessageActivity", () => {
  it.effect("counts local days of messages a person sent, from the first one", () =>
    Effect.gen(function* () {
      yield* insertMessages([
        { at: "2026-11-01T22:30:00.000Z" },
        { at: "2026-11-02T01:30:00.000Z" },
        { at: "2026-11-05T10:00:00.000Z", creationSource: "mobile" },
        // Task agents, automations and replies do not count.
        { at: "2026-10-01T10:00:00.000Z", createdBy: "agent" },
        { at: "2026-10-02T10:00:00.000Z", createdBy: "system" },
        { at: "2026-10-03T10:00:00.000Z", role: "assistant" },
        // Nor do sessions imported from Claude or Codex, or V1 task-agent prompts: the server wrote them.
        { at: "2026-09-01T10:00:00.000Z", creationSource: "server" },
        { at: "2026-09-02T10:00:00.000Z", creationSource: "server" },
      ]);
      // UTC: Nov 1, Nov 2 and Nov 5.
      assert.deepEqual(yield* readUserMessageActivity(0), {
        firstMessageAt: Date.parse("2026-11-01T22:30:00.000Z"),
        activeDays: 3,
      });
      // UTC+3: the first two are both on Nov 2.
      assert.strictEqual((yield* readUserMessageActivity(180)).activeDays, 2);
      // UTC-5: the first two are both on Nov 1.
      assert.strictEqual((yield* readUserMessageActivity(-300)).activeDays, 2);
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );

  it.effect("reads no activity before the first message", () =>
    Effect.map(readUserMessageActivity(0), (activity) =>
      assert.deepEqual(activity, { firstMessageAt: null, activeDays: 0 }),
    ).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );
});

describe("activityQualifies", () => {
  it("needs a first message at least 7 days ago and messages on 3 days", () => {
    const cases = [
      { firstMessageAt: NOW - 7 * DAY, activeDays: 3, expected: true },
      { firstMessageAt: NOW - 7 * DAY + 1, activeDays: 3, expected: false },
      { firstMessageAt: NOW - 40 * DAY, activeDays: 2, expected: false },
      { firstMessageAt: null, activeDays: 0, expected: false },
    ];
    for (const { expected, ...activity } of cases) {
      assert.strictEqual(activityQualifies(activity, NOW), expected, JSON.stringify(activity));
    }
  });
});

describe("surveyNotHandled", () => {
  const at = (daysAgo: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - daysAgo * DAY));

  it("never asks a survey again, and waits 30 days after any survey", () => {
    assert.isTrue(surveyNotHandled({}, "feedback-2026-11", NOW));
    assert.isFalse(
      surveyNotHandled({ "feedback-2026-11": { at: at(400) } }, "feedback-2026-11", NOW),
    );
    assert.isFalse(
      surveyNotHandled({ "feedback-2026-08": { at: at(29) } }, "feedback-2026-11", NOW),
    );
    assert.isTrue(
      surveyNotHandled({ "feedback-2026-08": { at: at(30) } }, "feedback-2026-11", NOW),
    );
  });
});

describe("surveyBuildAllowed", () => {
  it("shows surveys in nightlies and releases, never in dev, local test or demo builds", () => {
    assert.deepEqual(
      (["dev", "localtest", "rc", "nightly", "stable"] as const).filter(surveyBuildAllowed),
      ["rc", "nightly", "stable"],
    );
  });
});
