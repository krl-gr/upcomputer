import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { ManagedPolicyDocument, UserFeedback, UserSurveyReport } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { UpcomputerBuildKind } from "@t3tools/shared/upcomputerIdentity";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import * as UserSurveys from "./UserSurveys.ts";

const SURVEY_ID = "feedback-2026-11";
const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
/** Messages a person sent 10, 9 and 8 days ago: enough to be asked. */
const USED_FOR_A_WEEK = [10, 9, 8];

interface SentEvent {
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** A PostHog stand-in that records captured events; nothing reaches the real project. */
function fakePostHog(options: { readonly batchStatus?: number } = {}) {
  const sent: Array<SentEvent> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag === "Uint8Array") {
        const body = JSON.parse(new TextDecoder().decode(request.body.body)) as {
          readonly batch: ReadonlyArray<SentEvent>;
        };
        sent.push(...body.batch);
      }
      return HttpClientResponse.fromWeb(
        request,
        new Response("{}", { status: options.batchStatus ?? 200 }),
      );
    }),
  );
  return { client, sent };
}

/** A thread history with one message a person sent on each of `daysAgo`. */
const layerHistory = (daysAgo: ReadonlyArray<number>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const days of daysAgo) {
        const at = DateTime.formatIso(DateTime.makeUnsafe(NOW - days * DAY));
        yield* sql`
          INSERT INTO orchestration_v2_projection_messages
            (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
          VALUES (${`message-${days}`}, 'thread-1', NULL, NULL, 'user', 0, ${at}, ${at},
            '{"createdBy":"user","creationSource":"web"}')
        `;
      }
    }),
  ).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

/** One server run on `baseDir`, until `use` returns. */
const runServer = <A, E>(
  baseDir: string,
  client: HttpClient.HttpClient,
  use: (surveys: UserSurveys.UserSurveys["Service"]) => Effect.Effect<A, E>,
  options: {
    readonly telemetry?: boolean;
    readonly policy?: ManagedPolicyDocument;
    readonly buildKind?: UpcomputerBuildKind;
    readonly history?: ReadonlyArray<number>;
  } = {},
) =>
  Effect.flatMap(UserSurveys.UserSurveys, use).pipe(
    Effect.provide(
      UserSurveys.layerForBuild(options.buildKind ?? "stable").pipe(
        Layer.provideMerge(AnalyticsService.layer),
        Layer.provideMerge(layerHistory(options.history ?? USED_FOR_A_WEEK)),
        Layer.provideMerge(ServerConfig.ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provideMerge(ManagedPolicy.layerTest(options.policy)),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              T3CODE_TELEMETRY_ENABLED: options.telemetry ?? true,
              T3CODE_POSTHOG_KEY: "phc_test_key",
              T3CODE_POSTHOG_HOST: "http://posthog.test",
            }),
          ),
        ),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      ),
    ),
    // Provider login files would otherwise come from the real home directory.
    Effect.provideService(HostProcess.HomeDirectory, baseDir),
    Effect.provideService(HostProcess.KernelRelease, "25.2.0"),
  );

const CARD_ANSWER: UserSurveyReport = {
  _tag: "Partial",
  surveyId: SURVEY_ID,
  answers: [{ questionId: "working", value: "Something's off" }],
};

/** Continue on the form's first step: the answers so far, the card's included. */
const PROBLEM_STEP: UserSurveyReport = {
  _tag: "Partial",
  surveyId: SURVEY_ID,
  answers: [
    { questionId: "working", value: "Something's off" },
    { questionId: "problem", value: "The sidebar flickers" },
  ],
};

const ANSWERED: UserSurveyReport = {
  _tag: "Answered",
  surveyId: SURVEY_ID,
  answers: [
    { questionId: "working", value: "Something's off" },
    { questionId: "problem", value: "The sidebar flickers" },
    { questionId: "next", value: ["Voice dictation", "Calendar sync"] },
  ],
};

const SYSTEM_INFO: NonNullable<UserFeedback["systemInfo"]> = {
  appVersion: "0.0.40",
  system: "macOS (arm64)",
  providers: ["Codex", "Claude"],
};

const ANONYMOUS_KEYS = ["$geoip_disable", "$ip", "$process_person_profile"];

const surveyEvents = (sent: ReadonlyArray<SentEvent>) =>
  sent.filter((event) => event.event.startsWith("survey "));

const tempDir = Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
  fileSystem.makeTempDirectoryScoped({ prefix: "t3-user-surveys-" }),
);

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("UserSurveys", (it) => {
  it.effect("sends each confirmed step as a partial, then the full answer under the same id", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const baseDir = yield* tempDir;
      const posthog = fakePostHog();

      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.gen(function* () {
          assert.strictEqual((yield* surveys.current).survey?.id, SURVEY_ID);
          yield* surveys.report({ _tag: "Shown", surveyId: SURVEY_ID });
          yield* surveys.report({ _tag: "Shown", surveyId: SURVEY_ID });
          yield* surveys.report(CARD_ANSWER);
          yield* surveys.report(PROBLEM_STEP);
          yield* surveys.report(ANSWERED);
          assert.isNull((yield* surveys.current).survey);
        }),
      );
      // A restart remembers the answer from the state directory.
      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.map(surveys.current, (state) => assert.isNull(state.survey)),
      );

      // The answer goes out at once; `survey shown` and the partials wait in the analytics buffer.
      const events = surveyEvents(posthog.sent);
      assert.deepEqual(
        events.map((event) => [event.event, event.properties.$survey_completed]),
        [
          ["survey sent", true],
          ["survey shown", undefined],
          ["survey sent", false],
          ["survey sent", false],
        ],
      );
      const [sent, shown, card, step] = events;
      assert.strictEqual(sent!.distinct_id, shown!.distinct_id);
      assert.strictEqual(sent!.properties.$survey_id, SURVEY_ID);
      assert.isString(sent!.properties.$survey_submission_id);
      for (const partial of [card, step]) {
        assert.strictEqual(
          partial!.properties.$survey_submission_id,
          sent!.properties.$survey_submission_id,
        );
      }
      // Each partial carries every answer confirmed so far.
      assert.strictEqual(card!.properties.$survey_response_working, "Something's off");
      assert.notProperty(card!.properties, "$survey_response_problem");
      assert.strictEqual(step!.properties.$survey_response_working, "Something's off");
      assert.strictEqual(step!.properties.$survey_response_problem, "The sidebar flickers");
      // With analytics on, the answer carries the usual app details.
      assert.strictEqual(sent!.properties.$process_person_profile, false);
      assert.isString(sent!.properties.t3CodeVersion);
      assert.notProperty(sent!.properties, "$ip");
    }),
  );

  it.effect(
    "with analytics off, sends only the answers on Send, under a one-off anonymous id",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* tempDir;
        const posthog = fakePostHog();

        yield* runServer(
          baseDir,
          posthog.client,
          (surveys) =>
            Effect.gen(function* () {
              assert.strictEqual((yield* surveys.current).survey?.id, SURVEY_ID);
              yield* surveys.report({ _tag: "Shown", surveyId: SURVEY_ID });
              yield* surveys.report(CARD_ANSWER);
              yield* surveys.report(PROBLEM_STEP);
              yield* surveys.report(ANSWERED);
            }),
          { telemetry: false },
        );

        assert.deepEqual(
          posthog.sent.map((event) => event.event),
          ["survey sent"],
        );
        const [sent] = posthog.sent;
        assert.match(sent!.distinct_id, /^[0-9a-f-]{36}$/);
        assert.deepEqual(Object.keys(sent!.properties).toSorted(), [
          "$geoip_disable",
          "$ip",
          "$process_person_profile",
          "$survey_completed",
          "$survey_id",
          "$survey_name",
          "$survey_questions",
          "$survey_response_next",
          "$survey_response_problem",
          "$survey_response_working",
          "$survey_submission_id",
        ]);
        // PostHog would store the request's IP and its location unless the event says otherwise.
        assert.strictEqual(sent!.properties.$ip, "127.0.0.1");
        assert.strictEqual(sent!.properties.$geoip_disable, true);
        // No install identity is created for it.
        const stateDir = path.join(baseDir, "userdata");
        assert.isFalse(yield* fileSystem.exists(path.join(stateDir, "telemetry-id")));
        assert.isFalse(yield* fileSystem.exists(path.join(stateDir, "anonymous-id")));
      }),
  );

  it.effect("keeps offering the survey when the answer could not be sent", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const baseDir = yield* tempDir;
      const posthog = fakePostHog({ batchStatus: 503 });

      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.gen(function* () {
          const failure = yield* Effect.flip(surveys.report(ANSWERED));
          assert.strictEqual(failure.reason, "send-failed");
          assert.strictEqual((yield* surveys.current).survey?.id, SURVEY_ID);
        }),
      );
    }),
  );

  it.effect("a dismissal carries its step, is partial after a step, and hides the survey", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const baseDir = yield* tempDir;
      const posthog = fakePostHog();

      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.gen(function* () {
          yield* surveys.report(CARD_ANSWER);
          yield* surveys.report(PROBLEM_STEP);
          yield* surveys.report({
            _tag: "Dismissed",
            surveyId: SURVEY_ID,
            step: { questionId: "next", index: 2 },
          });
          assert.isNull((yield* surveys.current).survey);
          const failure = yield* Effect.flip(surveys.report({ ...ANSWERED, surveyId: "gone" }));
          assert.strictEqual(failure.reason, "unavailable");
          // Another client still showing it cannot send an answer or a step after the dismissal.
          const late = yield* Effect.flip(surveys.report(ANSWERED));
          assert.strictEqual(late.reason, "unavailable");
          yield* surveys.report(PROBLEM_STEP);
        }),
      );
      yield* TestClock.adjust(400 * DAY);
      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.map(surveys.current, (state) => assert.isNull(state.survey)),
      );

      const events = surveyEvents(posthog.sent);
      assert.deepEqual(
        events.map((event) => event.event),
        ["survey sent", "survey sent", "survey dismissed"],
      );
      const [, partial, dismissed] = events;
      assert.strictEqual(dismissed!.event, "survey dismissed");
      assert.strictEqual(dismissed!.properties.$survey_partially_completed, true);
      assert.strictEqual(dismissed!.properties.dismissedAtQuestionId, "next");
      assert.strictEqual(dismissed!.properties.dismissedAtStep, 2);
      assert.strictEqual(dismissed!.properties.$survey_response_problem, "The sidebar flickers");
      assert.strictEqual(
        dismissed!.properties.$survey_submission_id,
        partial!.properties.$survey_submission_id,
      );
    }),
  );

  it.effect("asks once the computer qualifies, without a restart", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const baseDir = yield* tempDir;
      const posthog = fakePostHog();

      yield* runServer(
        baseDir,
        posthog.client,
        (surveys) =>
          Effect.gen(function* () {
            assert.isNull((yield* surveys.current).survey);
            yield* TestClock.adjust(4 * DAY);
            assert.strictEqual((yield* surveys.current).survey?.id, SURVEY_ID);
          }),
        // The first message was only 3 days ago.
        { history: [3, 2, 1] },
      );
    }),
  );

  it.effect("never asks in a dev build or when the organization turned analytics off", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const baseDir = yield* tempDir;
      const posthog = fakePostHog();
      const offered = (options: Parameters<typeof runServer>[3]) =>
        runServer(
          baseDir,
          posthog.client,
          (surveys) =>
            Effect.gen(function* () {
              const failure = yield* Effect.flip(surveys.report(ANSWERED));
              assert.strictEqual(failure.reason, "unavailable");
              return (yield* surveys.current).survey;
            }),
          options,
        );

      assert.isNull(yield* offered({ buildKind: "dev" }));
      assert.isNull(
        yield* offered({
          policy: { schemaVersion: 1, organization: "Acme", limits: { telemetry: false } },
        }),
      );
      assert.deepEqual(surveyEvents(posthog.sent), []);
    }),
  );
  it.effect("feedback carries the email and system info only when they were checked", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const baseDir = yield* tempDir;
      const send = (feedback: UserFeedback, telemetry: boolean) =>
        Effect.gen(function* () {
          const posthog = fakePostHog();
          yield* runServer(baseDir, posthog.client, (surveys) => surveys.sendFeedback(feedback), {
            telemetry,
          });
          const sent = posthog.sent.filter((event) => event.event === "feedback sent");
          assert.lengthOf(sent, 1);
          return sent[0]!;
        });

      // Neither box: only the words, anonymously, also with analytics on.
      const bare = yield* send({ text: "The sidebar flickers" }, true);
      assert.deepEqual(Object.keys(bare.properties).toSorted(), [...ANONYMOUS_KEYS, "feedback"]);
      assert.strictEqual(bare.properties.feedback, "The sidebar flickers");
      assert.match(bare.distinct_id, /^[0-9a-f-]{36}$/);

      // The email alone still leaves the app details out.
      const withEmail = yield* send({ text: "Idea", email: "alex@example.com" }, true);
      assert.deepEqual(Object.keys(withEmail.properties).toSorted(), [
        ...ANONYMOUS_KEYS,
        "email",
        "feedback",
      ]);
      assert.strictEqual(withEmail.properties.email, "alex@example.com");

      // System info with analytics on: identified, with the usual app details and the kernel version.
      const withInfo = yield* send({ text: "Idea", systemInfo: SYSTEM_INFO }, true);
      assert.notProperty(withInfo.properties, "$ip");
      assert.notProperty(withInfo.properties, "email");
      assert.isString(withInfo.properties.t3CodeVersion);
      assert.strictEqual(withInfo.properties.appVersion, "0.0.40");
      assert.strictEqual(withInfo.properties.system, "macOS (arm64)");
      assert.strictEqual(withInfo.properties.kernelRelease, "25.2.0");
      assert.deepEqual(withInfo.properties.providers, ["Codex", "Claude"]);

      // System info with analytics off: still anonymous, with only what the form listed.
      const offWithInfo = yield* send({ text: "Idea", systemInfo: SYSTEM_INFO }, false);
      assert.deepEqual(Object.keys(offWithInfo.properties).toSorted(), [
        ...ANONYMOUS_KEYS,
        "appVersion",
        "feedback",
        "kernelRelease",
        "providers",
        "system",
      ]);
    }),
  );

  it.effect(
    "feedback is not sent from a dev build and is refused when analytics is managed off",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const baseDir = yield* tempDir;
        const posthog = fakePostHog();
        const feedback: UserFeedback = { text: "The sidebar flickers" };

        yield* runServer(baseDir, posthog.client, (surveys) => surveys.sendFeedback(feedback), {
          buildKind: "dev",
        });
        const refused = yield* runServer(
          baseDir,
          posthog.client,
          (surveys) => Effect.flip(surveys.sendFeedback(feedback)),
          { policy: { schemaVersion: 1, organization: "Acme", limits: { telemetry: false } } },
        );
        assert.strictEqual(refused.reason, "unavailable");
        assert.deepEqual(
          posthog.sent.filter((event) => event.event === "feedback sent"),
          [],
        );

        const failed = yield* runServer(
          baseDir,
          fakePostHog({ batchStatus: 503 }).client,
          (surveys) => Effect.flip(surveys.sendFeedback(feedback)),
        );
        assert.strictEqual(failed.reason, "send-failed");
      }),
  );
});
