import { type UserSurveyReport, UserSurveyError, type UserSurveyState } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import {
  type ActiveUserSurvey,
  parseUserSurveys,
  selectUserSurvey,
  surveyEventProperties,
  surveySentProperties,
} from "./UserSurveyDefinition.ts";

const REFRESH_INTERVAL_MS = 60 * 60_000;
// Offline at launch should not hide a survey for the whole hour.
const RETRY_INTERVAL_MS = 10 * 60_000;
const FETCH_TIMEOUT = "5 seconds";
const HANDLED_FILE = "user-surveys.json";

const HandledSurveys = Schema.Record(
  Schema.String,
  Schema.Struct({ status: Schema.Literals(["answered", "dismissed"]), at: Schema.String }),
);
type HandledSurveys = typeof HandledSurveys.Type;
const decodeHandled = Schema.decodeUnknownOption(Schema.fromJsonString(HandledSurveys));
const encodeHandled = Schema.encodeSync(Schema.fromJsonString(HandledSurveys));

/**
 * Surveys launched in the Up.computer PostHog project. Read when a client
 * asks, at most hourly, so a headless server never calls PostHog. Which
 * surveys this install answered or dismissed is kept in its state directory.
 */
export class UserSurveys extends Context.Service<
  UserSurveys,
  {
    /** The survey to offer now; empty when PostHog cannot be reached. */
    readonly current: Effect.Effect<UserSurveyState>;
    readonly report: (report: UserSurveyReport) => Effect.Effect<void, UserSurveyError>;
  }
>()("t3/userSurveys/UserSurveys") {}

const make = Effect.gen(function* () {
  const analytics = yield* AnalyticsService.AnalyticsService;
  const project = yield* AnalyticsService.PostHogProjectConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* SecureRandom.SecureRandom;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  // An administrator who turned analytics off for the organization gets no surveys either.
  const allowed =
    ManagedPolicy.deniedBy(yield* ManagedPolicy.ManagedPolicy, "telemetry") === undefined;
  const handledPath = path.join(stateDir, HANDLED_FILE);
  const writeContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  const surveysRef = yield* Ref.make<{
    readonly surveys: ReadonlyArray<ActiveUserSurvey>;
    readonly refreshAt: number;
  }>({ surveys: [], refreshAt: 0 });
  const refreshLock = yield* Semaphore.make(1);
  const handledRef = yield* Ref.make<HandledSurveys | null>(null);
  const handledLock = yield* Semaphore.make(1);
  const shownRef = yield* Ref.make<ReadonlySet<string>>(new Set());

  const fetchSurveys = HttpClientRequest.get(`${project.posthogHost}/api/surveys/`).pipe(
    HttpClientRequest.setUrlParam("token", project.posthogKey),
    httpClient.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.map(parseUserSurveys),
    Effect.timeout(FETCH_TIMEOUT),
  );

  const refreshIfDue = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (now < (yield* Ref.get(surveysRef)).refreshAt) return;
    const fetched = yield* Effect.option(
      fetchSurveys.pipe(
        Effect.tapCause((cause) => Effect.logDebug("Could not load surveys", { cause })),
      ),
    );
    yield* Ref.update(surveysRef, (current) =>
      Option.match(fetched, {
        onNone: () => ({ surveys: current.surveys, refreshAt: now + RETRY_INTERVAL_MS }),
        onSome: (surveys) => ({ surveys, refreshAt: now + REFRESH_INTERVAL_MS }),
      }),
    );
  }).pipe(refreshLock.withPermit);

  const handled = Effect.gen(function* () {
    const loaded = yield* Ref.get(handledRef);
    if (loaded !== null) return loaded;
    const read = yield* fileSystem.readFileString(handledPath).pipe(
      Effect.map((text) => Option.getOrElse(decodeHandled(text), () => ({}))),
      Effect.orElseSucceed(() => ({})),
    );
    yield* Ref.set(handledRef, read);
    return read;
  }).pipe(handledLock.withPermit);

  const remember = Effect.fn("UserSurveys.remember")(function* (
    key: string,
    status: "answered" | "dismissed",
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    const next = { ...(yield* handled), [key]: { status, at } };
    yield* Ref.set(handledRef, next);
    yield* writeFileStringAtomically({ filePath: handledPath, contents: encodeHandled(next) }).pipe(
      Effect.provideContext(writeContext),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not save which surveys were answered", { cause }),
      ),
    );
  });

  const current: UserSurveys["Service"]["current"] = Effect.gen(function* () {
    if (!allowed) return { survey: null };
    yield* refreshIfDue;
    const { surveys } = yield* Ref.get(surveysRef);
    const active = selectUserSurvey(surveys, new Set(Object.keys(yield* handled)));
    return { survey: active?.survey ?? null };
  }).pipe(Effect.withSpan("UserSurveys.current"));

  const report: UserSurveys["Service"]["report"] = Effect.fn("UserSurveys.report")(
    function* (input) {
      const active = (yield* Ref.get(surveysRef)).surveys.find(
        (candidate) => candidate.survey.id === input.surveyId,
      );
      if (!allowed || active === undefined) {
        if (input._tag === "Answered") {
          return yield* new UserSurveyError({ reason: "unavailable" });
        }
        return;
      }
      switch (input._tag) {
        case "Shown": {
          const firstShow = yield* Ref.modify(shownRef, (shown) =>
            shown.has(active.key) ? [false, shown] : [true, new Set(shown).add(active.key)],
          );
          // `record` sends nothing when analytics is off.
          if (firstShow) yield* analytics.record("survey shown", surveyEventProperties(active));
          return;
        }
        case "Dismissed": {
          yield* remember(active.key, "dismissed");
          yield* analytics.record("survey dismissed", {
            ...surveyEventProperties(active),
            $survey_partially_completed: false,
          });
          return;
        }
        case "Answered": {
          const submissionId = yield* crypto.uuidV4().pipe(Effect.orDie);
          const sent = yield* analytics.sendNow(
            "survey sent",
            surveySentProperties(active, input.answers, submissionId),
          );
          if (!sent) return yield* new UserSurveyError({ reason: "send-failed" });
          yield* remember(active.key, "answered");
        }
      }
    },
  );

  return UserSurveys.of({ current, report });
});

export const layer = Layer.effect(UserSurveys, make);
