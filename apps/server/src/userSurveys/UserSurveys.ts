import {
  type UserFeedback,
  UserFeedbackError,
  type UserSurveyAnswer,
  type UserSurveyReport,
  UserSurveyError,
  type UserSurveyState,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import type { UpcomputerBuildKind } from "@t3tools/shared/upcomputerIdentity";
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
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import {
  FEEDBACK_SURVEY,
  surveyEventProperties,
  surveyResponseProperties,
} from "./UserSurveyDefinition.ts";
import {
  activityQualifies,
  MIN_ACTIVE_DAYS,
  readUserMessageActivity,
  surveyBuildAllowed,
  surveyNotHandled,
  type UserMessageActivity,
} from "./UserSurveyEligibility.ts";

// Clients ask about hourly; a reconnect storm still reads the history once.
const ACTIVITY_RECHECK_MS = 60 * 60_000;
const HANDLED_FILE = "user-surveys.json";

const HandledSurveys = Schema.Record(
  Schema.String,
  Schema.Struct({ status: Schema.Literals(["answered", "dismissed"]), at: Schema.String }),
);
type HandledSurveys = typeof HandledSurveys.Type;
const decodeHandled = Schema.decodeUnknownOption(Schema.fromJsonString(HandledSurveys));
const encodeHandled = Schema.encodeSync(Schema.fromJsonString(HandledSurveys));

/**
 * The survey built into this release, offered once the person has used the
 * app for a while. Which surveys this computer answered or dismissed, and
 * when, is kept in its state directory.
 */
export class UserSurveys extends Context.Service<
  UserSurveys,
  {
    /** The survey to offer now, if this computer qualifies. */
    readonly current: Effect.Effect<UserSurveyState>;
    readonly report: (report: UserSurveyReport) => Effect.Effect<void, UserSurveyError>;
    /** Feedback from the notifications popover, sent at once like a survey answer. */
    readonly sendFeedback: (feedback: UserFeedback) => Effect.Effect<void, UserFeedbackError>;
  }
>()("t3/userSurveys/UserSurveys") {}

const make = Effect.fn("UserSurveys.make")(function* (buildKind: UpcomputerBuildKind | undefined) {
  const analytics = yield* AnalyticsService.AnalyticsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* SecureRandom.SecureRandom;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const sqlContext = yield* Effect.context<SqlClient.SqlClient>();
  // An administrator who turned analytics off for the organization gets no surveys either.
  const policyAllows =
    ManagedPolicy.deniedBy(yield* ManagedPolicy.ManagedPolicy, "telemetry") === undefined;
  const buildAllowed = surveyBuildAllowed(buildKind ?? (yield* AnalyticsService.serverBuildKind));
  const available = policyAllows && buildAllowed;
  const kernelRelease = yield* HostProcess.KernelRelease;
  const survey = FEEDBACK_SURVEY;
  const handledPath = path.join(stateDir, HANDLED_FILE);
  const writeContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

  const handledRef = yield* Ref.make<HandledSurveys | null>(null);
  const handledLock = yield* Semaphore.make(1);
  const activityRef = yield* Ref.make<{
    readonly activity: UserMessageActivity;
    readonly checkedAt: number;
  } | null>(null);
  const activityLock = yield* Semaphore.make(1);
  const shownRef = yield* Ref.make(false);
  // The answers confirmed so far and their submission id, which Send and a dismissal reuse.
  const partialRef = yield* Ref.make<ReadonlyArray<UserSurveyAnswer> | null>(null);
  const submissionIdRef = yield* Ref.make<string | null>(null);

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

  // Active days only grow, so once there are enough the history is not read again.
  const activity = Effect.fn("UserSurveys.activity")(function* (now: number) {
    const cached = yield* Ref.get(activityRef);
    if (
      cached !== null &&
      (cached.activity.activeDays >= MIN_ACTIVE_DAYS ||
        now - cached.checkedAt < ACTIVITY_RECHECK_MS)
    ) {
      return cached.activity;
    }
    const local = DateTime.makeZonedUnsafe(now, { timeZone: DateTime.zoneMakeLocal() });
    const utcOffsetMinutes = DateTime.zonedOffset(local) / 60_000;
    const read = yield* readUserMessageActivity(utcOffsetMinutes).pipe(
      Effect.provideContext(sqlContext),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not read the thread history for surveys", { cause }).pipe(
          Effect.as({ firstMessageAt: null, activeDays: 0 }),
        ),
      ),
    );
    yield* Ref.set(activityRef, { activity: read, checkedAt: now });
    return read;
  }, activityLock.withPermit);

  const remember = Effect.fn("UserSurveys.remember")(function* (
    surveyId: string,
    status: "answered" | "dismissed",
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    const next = { ...(yield* handled), [surveyId]: { status, at } };
    yield* Ref.set(handledRef, next);
    yield* writeFileStringAtomically({
      filePath: handledPath,
      contents: encodeHandled(next),
    }).pipe(
      Effect.provideContext(writeContext),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not save which surveys were answered", { cause }),
      ),
    );
  });

  const current: UserSurveys["Service"]["current"] = Effect.gen(function* () {
    if (!available) return { survey: null };
    const now = yield* Clock.currentTimeMillis;
    if (!surveyNotHandled(yield* handled, survey.id, now)) return { survey: null };
    if (!activityQualifies(yield* activity(now), now)) return { survey: null };
    return { survey };
  }).pipe(Effect.withSpan("UserSurveys.current"));

  const submissionId = Effect.gen(function* () {
    const fresh = yield* crypto.uuidV4().pipe(Effect.orDie);
    return yield* Ref.modify(submissionIdRef, (current) => {
      const id = current ?? fresh;
      return [id, id] as const;
    });
  });

  // `record` sends nothing when analytics is off; only an answer sent with Send goes out then.
  const report: UserSurveys["Service"]["report"] = Effect.fn("UserSurveys.report")(
    function* (input) {
      // Another client may have answered or dismissed it already; one person sends one of those.
      const open =
        available &&
        input.surveyId === survey.id &&
        surveyNotHandled(yield* handled, survey.id, yield* Clock.currentTimeMillis);
      if (!open) {
        if (input._tag === "Answered") {
          return yield* new UserSurveyError({ reason: "unavailable" });
        }
        return;
      }
      switch (input._tag) {
        case "Shown": {
          const alreadyShown = yield* Ref.getAndSet(shownRef, true);
          if (!alreadyShown) yield* analytics.record("survey shown", surveyEventProperties(survey));
          return;
        }
        case "Partial": {
          const id = yield* submissionId;
          yield* Ref.set(partialRef, input.answers);
          yield* analytics.record(
            "survey sent",
            surveyResponseProperties(survey, input.answers, id, { completed: false }),
          );
          return;
        }
        case "Dismissed": {
          const answers = yield* Ref.getAndSet(partialRef, null);
          const id = yield* Ref.getAndSet(submissionIdRef, null);
          yield* remember(survey.id, "dismissed");
          yield* analytics.record("survey dismissed", {
            ...(answers === null || id === null
              ? { ...surveyEventProperties(survey), $survey_partially_completed: false }
              : surveyResponseProperties(survey, answers, id, "dismissed")),
            // Not posthog-js properties: where each person stopped, for a drop-off funnel.
            dismissedAtQuestionId: input.step.questionId,
            dismissedAtStep: input.step.index,
          });
          return;
        }
        case "Answered": {
          const sent = yield* analytics.sendNow(
            "survey sent",
            surveyResponseProperties(survey, input.answers, yield* submissionId, {
              completed: true,
            }),
          );
          if (!sent) return yield* new UserSurveyError({ reason: "send-failed" });
          yield* Ref.set(partialRef, null);
          yield* Ref.set(submissionIdRef, null);
          yield* remember(survey.id, "answered");
        }
      }
    },
  );

  // Like an answer sent with Send, it goes out with analytics off too. Without system info
  // it goes anonymously, so it carries none of the app details identified events add.
  const sendFeedback: UserSurveys["Service"]["sendFeedback"] = Effect.fn(
    "UserSurveys.sendFeedback",
  )(function* (feedback) {
    if (!policyAllows) return yield* new UserFeedbackError({ reason: "unavailable" });
    if (!buildAllowed) {
      yield* Effect.logInfo("Feedback is not sent from development builds");
      return;
    }
    const { systemInfo } = feedback;
    const sent = yield* analytics.sendNow(
      "feedback sent",
      {
        feedback: feedback.text,
        ...(feedback.email === undefined ? {} : { email: feedback.email }),
        ...(systemInfo === undefined
          ? {}
          : {
              appVersion: systemInfo.appVersion,
              system: systemInfo.system,
              kernelRelease,
              providers: systemInfo.providers,
            }),
      },
      { anonymous: systemInfo === undefined },
    );
    if (!sent) return yield* new UserFeedbackError({ reason: "send-failed" });
  });

  return UserSurveys.of({ current, report, sendFeedback });
});

export const layer = Layer.effect(UserSurveys, make(undefined));

/** A server of the given build kind, for tests; dev builds never ask. */
export const layerForBuild = (buildKind: UpcomputerBuildKind) =>
  Layer.effect(UserSurveys, make(buildKind));
