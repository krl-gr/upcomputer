import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { ManagedPolicyDocument, UserSurveyReport } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import fixture from "./fixtures/posthogSurveys.json" with { type: "json" };
import * as UserSurveys from "./UserSurveys.ts";

const SURVEY_ID = "0199a1b2-0000-7000-8000-000000000001";

interface SentEvent {
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** A PostHog stand-in: serves the fixture surveys and records captured events. */
function fakePostHog(options: { readonly surveys?: unknown; readonly batchStatus?: number } = {}) {
  const sent: Array<SentEvent> = [];
  const surveyRequests: Array<string> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/surveys/") {
        const params = new URLSearchParams(UrlParams.toString(request.urlParams));
        surveyRequests.push(params.get("token") ?? "");
        return options.surveys === undefined
          ? HttpClientResponse.fromWeb(request, new Response(null, { status: 503 }))
          : HttpClientResponse.fromWeb(request, Response.json(options.surveys));
      }
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
  return { client, sent, surveyRequests };
}

/** One server run on `baseDir`, until `use` returns. */
const runServer = <A, E>(
  baseDir: string,
  client: HttpClient.HttpClient,
  use: (surveys: UserSurveys.UserSurveys["Service"]) => Effect.Effect<A, E>,
  options: { readonly telemetry?: boolean; readonly policy?: ManagedPolicyDocument } = {},
) =>
  Effect.flatMap(UserSurveys.UserSurveys, use).pipe(
    Effect.provide(
      UserSurveys.layer.pipe(
        Layer.provideMerge(AnalyticsService.layer),
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
  );

const ANSWERED: UserSurveyReport = {
  _tag: "Answered",
  surveyId: SURVEY_ID,
  answers: [
    { questionId: "q-working", value: "Something's off" },
    { questionId: "q-details", value: "The sidebar flickers" },
    { questionId: "q-missing", value: ["Voice dictation", "Calendar sync"] },
  ],
};

const surveyEvents = (sent: ReadonlyArray<SentEvent>) =>
  sent.filter((event) => event.event.startsWith("survey "));

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("UserSurveys", (it) => {
  it.effect("sends answers as `survey sent` and does not offer the survey again", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-user-surveys-" });
      const posthog = fakePostHog({ surveys: fixture });

      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.gen(function* () {
          assert.strictEqual((yield* surveys.current).survey?.id, SURVEY_ID);
          yield* surveys.report({ _tag: "Shown", surveyId: SURVEY_ID });
          yield* surveys.report({ _tag: "Shown", surveyId: SURVEY_ID });
          yield* surveys.report(ANSWERED);
          assert.isNull((yield* surveys.current).survey);
        }),
      );
      // A restart remembers the answer from the state directory.
      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.map(surveys.current, (state) => assert.isNull(state.survey)),
      );

      assert.deepEqual(posthog.surveyRequests, ["phc_test_key", "phc_test_key"]);
      const events = surveyEvents(posthog.sent);
      // `survey shown` waits in the analytics buffer; the answer goes out at once.
      assert.deepEqual(
        events.map((event) => event.event),
        ["survey sent", "survey shown"],
      );
      const [sent, shown] = events;
      assert.strictEqual(sent!.distinct_id, shown!.distinct_id);
      assert.strictEqual(sent!.properties.$survey_id, SURVEY_ID);
      assert.strictEqual(sent!.properties["$survey_response_q-details"], "The sidebar flickers");
      assert.deepEqual(sent!.properties["$survey_response_q-missing"], [
        "Voice dictation",
        "Calendar sync",
      ]);
      assert.strictEqual(sent!.properties.$survey_completed, true);
      assert.isString(sent!.properties.$survey_submission_id);
      // With analytics on, the answer carries the usual app details.
      assert.strictEqual(sent!.properties.$process_person_profile, false);
      assert.isString(sent!.properties.t3CodeVersion);
      assert.strictEqual(shown!.properties.$survey_name, "How can we improve Up.computer");
    }),
  );

  it.effect("with analytics off, sends only the answers, under a one-off anonymous id", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-user-surveys-" });
      const posthog = fakePostHog({ surveys: fixture });

      yield* runServer(
        baseDir,
        posthog.client,
        (surveys) =>
          Effect.gen(function* () {
            assert.strictEqual((yield* surveys.current).survey?.id, SURVEY_ID);
            yield* surveys.report({ _tag: "Shown", surveyId: SURVEY_ID });
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
        "$process_person_profile",
        "$survey_completed",
        "$survey_id",
        "$survey_name",
        "$survey_questions",
        "$survey_response_q-details",
        "$survey_response_q-missing",
        "$survey_response_q-working",
        "$survey_submission_id",
      ]);
      // No install identity is created for it.
      const stateDir = path.join(baseDir, "userdata");
      assert.isFalse(yield* fileSystem.exists(path.join(stateDir, "telemetry-id")));
      assert.isFalse(yield* fileSystem.exists(path.join(stateDir, "anonymous-id")));
    }),
  );

  it.effect("keeps offering the survey when the answer could not be sent", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-user-surveys-" });
      const posthog = fakePostHog({ surveys: fixture, batchStatus: 503 });

      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.gen(function* () {
          yield* surveys.current;
          const failure = yield* Effect.flip(surveys.report(ANSWERED));
          assert.strictEqual(failure.reason, "send-failed");
          assert.strictEqual((yield* surveys.current).survey?.id, SURVEY_ID);
        }),
      );
    }),
  );

  it.effect("a dismissed survey stays hidden; an unknown one cannot be answered", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-user-surveys-" });
      const posthog = fakePostHog({ surveys: fixture });

      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.gen(function* () {
          yield* surveys.current;
          yield* surveys.report({ _tag: "Dismissed", surveyId: SURVEY_ID });
          assert.isNull((yield* surveys.current).survey);
          const failure = yield* Effect.flip(surveys.report({ ...ANSWERED, surveyId: "gone" }));
          assert.strictEqual(failure.reason, "unavailable");
        }),
      );
      yield* runServer(baseDir, posthog.client, (surveys) =>
        Effect.map(surveys.current, (state) => assert.isNull(state.survey)),
      );
    }),
  );

  it.effect(
    "offers nothing when PostHog is unreachable or the organization turned analytics off",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-user-surveys-" });
        const offline = fakePostHog();
        yield* runServer(baseDir, offline.client, (surveys) =>
          Effect.gen(function* () {
            assert.isNull((yield* surveys.current).survey);
            // The failed read is not retried on every ask.
            assert.isNull((yield* surveys.current).survey);
          }),
        );
        assert.strictEqual(offline.surveyRequests.length, 1);

        const managed = fakePostHog({ surveys: fixture });
        yield* runServer(
          baseDir,
          managed.client,
          (surveys) => Effect.map(surveys.current, (state) => assert.isNull(state.survey)),
          { policy: { schemaVersion: 1, organization: "Acme", limits: { telemetry: false } } },
        );
        assert.deepEqual(managed.surveyRequests, []);
      }),
  );
});
