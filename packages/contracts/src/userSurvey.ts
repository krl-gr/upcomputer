import * as Schema from "effect/Schema";

/**
 * Shown only while the earlier single-choice question has one of `choices`
 * (their indexes) picked. Drawn under that question, as its follow-up.
 */
export const UserSurveyShowWhen = Schema.Struct({
  questionId: Schema.String,
  choices: Schema.Array(Schema.Number),
});
export type UserSurveyShowWhen = typeof UserSurveyShowWhen.Type;

const UserSurveyQuestionBase = {
  id: Schema.String,
  question: Schema.String,
  description: Schema.optionalKey(Schema.String),
  optional: Schema.Boolean,
  showWhen: Schema.optionalKey(UserSurveyShowWhen),
};

/** A PostHog survey question this app can draw; other types are left out of the survey. */
export const UserSurveyQuestion = Schema.Union([
  Schema.Struct({ ...UserSurveyQuestionBase, type: Schema.Literal("open") }),
  Schema.Struct({
    ...UserSurveyQuestionBase,
    type: Schema.Literals(["single_choice", "multiple_choice"]),
    choices: Schema.Array(Schema.String),
    /** The last choice takes the user's own words, as PostHog's "Other" does. */
    hasOpenChoice: Schema.Boolean,
  }),
]);
export type UserSurveyQuestion = typeof UserSurveyQuestion.Type;

/** An active PostHog survey for this install, with its questions as written there. */
export const UserSurvey = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  questions: Schema.Array(UserSurveyQuestion),
});
export type UserSurvey = typeof UserSurvey.Type;

export const UserSurveyState = Schema.Struct({ survey: Schema.NullOr(UserSurvey) });
export type UserSurveyState = typeof UserSurveyState.Type;

/** Single choice and open questions answer with a string, multiple choice with a list. */
export const UserSurveyAnswer = Schema.Struct({
  questionId: Schema.String,
  value: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
});
export type UserSurveyAnswer = typeof UserSurveyAnswer.Type;

export const UserSurveyReport = Schema.Union([
  Schema.TaggedStruct("Shown", { surveyId: Schema.String }),
  Schema.TaggedStruct("Dismissed", { surveyId: Schema.String }),
  Schema.TaggedStruct("Answered", {
    surveyId: Schema.String,
    answers: Schema.Array(UserSurveyAnswer),
  }),
]);
export type UserSurveyReport = typeof UserSurveyReport.Type;

export class UserSurveyError extends Schema.TaggedError<UserSurveyError>()("UserSurveyError", {
  reason: Schema.Literals(["unavailable", "send-failed"]),
}) {
  override get message(): string {
    return this.reason === "unavailable"
      ? "This survey has closed."
      : "Could not send your answers. Check your connection and try again.";
  }
}
