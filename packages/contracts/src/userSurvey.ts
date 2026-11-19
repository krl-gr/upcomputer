import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
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

export const UserSurveyChoice = Schema.Struct({
  label: Schema.String,
  /** Picking it opens a text box, and the person's own words are the answer. */
  kind: Schema.optionalKey(Schema.Literal("own-answer")),
});
export type UserSurveyChoice = typeof UserSurveyChoice.Type;

const UserSurveyQuestionBase = {
  id: Schema.String,
  question: Schema.String,
  /** The hint inside an empty text box. */
  placeholder: Schema.optionalKey(Schema.String),
  optional: Schema.Boolean,
  showWhen: Schema.optionalKey(UserSurveyShowWhen),
};

export const UserSurveyQuestion = Schema.Union([
  Schema.Struct({
    ...UserSurveyQuestionBase,
    type: Schema.Literal("open"),
    /** Asks how to reach the person: one line, not a text box. */
    kind: Schema.optionalKey(Schema.Literal("contact")),
  }),
  Schema.Struct({
    ...UserSurveyQuestionBase,
    type: Schema.Literals(["single_choice", "multiple_choice"]),
    choices: Schema.Array(UserSurveyChoice),
  }),
]);
export type UserSurveyQuestion = typeof UserSurveyQuestion.Type;

/** A survey built into the app; a new survey ships with a release under a new id. */
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
  Schema.TaggedStruct("Dismissed", {
    surveyId: Schema.String,
    /** The step the person left on: the card's question is 0, the form's steps follow. */
    step: Schema.Struct({ questionId: Schema.String, index: Schema.Number }),
  }),
  /** The answers confirmed so far: the card's, and each step left with Continue or Skip. */
  Schema.TaggedStruct("Partial", {
    surveyId: Schema.String,
    answers: Schema.Array(UserSurveyAnswer),
  }),
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
      : "Couldn't send. Check your connection and try again.";
  }
}

export const USER_SURVEY_RPC_NAMESPACE = "upcomputer.user-surveys.v1";
export const USER_SURVEY_RPC_METHODS = {
  current: `${USER_SURVEY_RPC_NAMESPACE}.current`,
  report: `${USER_SURVEY_RPC_NAMESPACE}.report`,
} as const;

/** The survey RPCs, a product feature on the core WebSocket transport. */
export const UserSurveyRpcGroup = RpcGroup.make(
  Rpc.make(USER_SURVEY_RPC_METHODS.current, {
    payload: Schema.Struct({}),
    success: UserSurveyState,
  }),
  Rpc.make(USER_SURVEY_RPC_METHODS.report, {
    payload: UserSurveyReport,
    error: UserSurveyError,
  }),
);
