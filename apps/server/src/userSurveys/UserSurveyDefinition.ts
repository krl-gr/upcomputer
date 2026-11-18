/**
 * PostHog survey definitions as this app reads them. The shapes follow
 * posthog-js (`@posthog/core` survey types) and its `survey sent` properties.
 */
import type { UserSurvey, UserSurveyAnswer, UserSurveyQuestion } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const NullableString = Schema.optionalKey(Schema.NullOr(Schema.String));

const PostHogBranching = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["next_question", "end"]) }),
  Schema.Struct({ type: Schema.Literal("specific_question"), index: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("response_based"),
    responseValues: Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String])),
  }),
]);

const PostHogQuestionBase = {
  id: Schema.String,
  question: Schema.String,
  description: NullableString,
  descriptionContentType: NullableString,
  optional: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  branching: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
};

const PostHogQuestion = Schema.Union([
  Schema.Struct({ ...PostHogQuestionBase, type: Schema.Literal("open") }),
  Schema.Struct({
    ...PostHogQuestionBase,
    type: Schema.Literals(["single_choice", "multiple_choice"]),
    choices: Schema.NonEmptyArray(Schema.String),
    hasOpenChoice: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  }),
]);
type PostHogQuestion = typeof PostHogQuestion.Type;

const PostHogSurvey = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  start_date: NullableString,
  end_date: NullableString,
  linked_flag_key: NullableString,
  targeting_flag_key: NullableString,
  current_iteration: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  current_iteration_start_date: NullableString,
  questions: Schema.Array(Schema.Unknown),
});

const PostHogSurveys = Schema.Struct({ surveys: Schema.Array(Schema.Unknown) });

const decodeSurveys = Schema.decodeUnknownOption(PostHogSurveys);
const decodeSurvey = Schema.decodeUnknownOption(PostHogSurvey);
const decodeQuestion = Schema.decodeUnknownOption(PostHogQuestion);
const decodeBranching = Schema.decodeUnknownOption(PostHogBranching);

/** A survey this app can show, with what its events need beside the questions. */
export interface ActiveUserSurvey {
  readonly survey: UserSurvey;
  /** Answers and dismissals are remembered per key: a new iteration asks again. */
  readonly key: string;
  readonly startDate: string;
  readonly iteration: number | null;
  readonly iterationStartDate: string | null;
}

/**
 * Index of the question `question` leads to for its `choice`, as posthog-js
 * reads `response_based` branching. `questionCount` stands for the end.
 */
function choiceTarget(
  responseValues: Readonly<Record<string, number | string>>,
  choice: number,
  index: number,
  questionCount: number,
): number {
  const target = responseValues[String(choice)];
  if (typeof target === "number" && Number.isInteger(target)) return target;
  if (target === "end") return questionCount;
  return index + 1;
}

/**
 * A single-choice question whose branching sends some choices to the next
 * question and every other choice past it makes that next question a
 * follow-up: the form draws it under those choices. Other branching is not
 * followed, since the form shows every question on one page.
 */
function followUps(
  questions: ReadonlyArray<PostHogQuestion>,
): ReadonlyMap<number, { readonly questionId: string; readonly choices: number[] }> {
  const result = new Map<number, { questionId: string; choices: number[] }>();
  questions.forEach((question, index) => {
    if (question.type !== "single_choice" || index + 1 >= questions.length) return;
    const branching = Option.getOrUndefined(decodeBranching(question.branching));
    if (branching?.type !== "response_based") return;
    const targets = question.choices.map((_, choice) =>
      choiceTarget(branching.responseValues, choice, index, questions.length),
    );
    const leading = targets.flatMap((target, choice) => (target === index + 1 ? [choice] : []));
    const skipping = targets.every((target) => target >= index + 1);
    if (leading.length === 0 || leading.length === targets.length || !skipping) return;
    result.set(index + 1, { questionId: question.id, choices: leading });
  });
  return result;
}

function toUserSurveyQuestion(
  question: PostHogQuestion,
  showWhen: { readonly questionId: string; readonly choices: number[] } | undefined,
): UserSurveyQuestion {
  // HTML descriptions would show their tags as text.
  const description =
    question.description && question.descriptionContentType !== "html"
      ? question.description
      : undefined;
  const base = {
    id: question.id,
    question: question.question,
    ...(description ? { description } : {}),
    optional: question.optional === true,
    ...(showWhen ? { showWhen } : {}),
  };
  return question.type === "open"
    ? { ...base, type: "open" }
    : {
        ...base,
        type: question.type,
        choices: question.choices,
        hasOpenChoice: question.hasOpenChoice === true,
      };
}

/**
 * The response of PostHog's public `/api/surveys/` as surveys this app can
 * show: started, not ended, of the API type (popover surveys are the
 * website's), and not targeted by a feature flag the app cannot evaluate.
 * Questions of other types are left out; a survey with none left is skipped.
 */
export function parseUserSurveys(body: unknown): ReadonlyArray<ActiveUserSurvey> {
  const surveys = Option.match(decodeSurveys(body), {
    onNone: () => [],
    onSome: (decoded) => decoded.surveys,
  });
  return surveys.flatMap((raw) => {
    const survey = Option.getOrUndefined(decodeSurvey(raw));
    if (
      !survey ||
      survey.type !== "api" ||
      !survey.start_date ||
      survey.end_date ||
      survey.linked_flag_key ||
      survey.targeting_flag_key
    ) {
      return [];
    }
    const questions = survey.questions.flatMap((question) =>
      Option.toArray(decodeQuestion(question)),
    );
    if (questions.length === 0) return [];
    const followUp = followUps(questions);
    const iteration =
      typeof survey.current_iteration === "number" && survey.current_iteration > 0
        ? survey.current_iteration
        : null;
    return [
      {
        survey: {
          id: survey.id,
          name: survey.name,
          questions: questions.map((question, index) =>
            toUserSurveyQuestion(question, followUp.get(index)),
          ),
        },
        key: iteration === null ? survey.id : `${survey.id}_${iteration}`,
        startDate: survey.start_date,
        iteration,
        iterationStartDate: survey.current_iteration_start_date ?? null,
      },
    ];
  });
}

/** The newest survey this install has not answered or dismissed. */
export function selectUserSurvey(
  surveys: ReadonlyArray<ActiveUserSurvey>,
  handledKeys: ReadonlySet<string>,
): ActiveUserSurvey | null {
  return (
    surveys
      .filter((active) => !handledKeys.has(active.key))
      .toSorted((left, right) => right.startDate.localeCompare(left.startDate))[0] ?? null
  );
}

/** What every survey event carries, as posthog-js sends it. */
export function surveyEventProperties(active: ActiveUserSurvey): Record<string, unknown> {
  return {
    $survey_id: active.survey.id,
    $survey_name: active.survey.name,
    ...(active.iteration === null
      ? {}
      : {
          $survey_iteration: active.iteration,
          $survey_iteration_start_date: active.iterationStartDate,
        }),
  };
}

/** The open choice answers with the user's own words, so any other text picks it. */
function choiceIndex(choices: ReadonlyArray<string>, hasOpenChoice: boolean, picked: string) {
  const index = choices.indexOf(picked);
  return index === -1 && hasOpenChoice ? choices.length - 1 : index;
}

function answerValue(
  question: UserSurveyQuestion,
  value: UserSurveyAnswer["value"],
): string | string[] | null {
  if (question.type === "multiple_choice") {
    const values = (typeof value === "string" ? [value] : value)
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return values.length === 0 ? null : values;
  }
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value.trim();
}

/**
 * `survey sent` properties for `answers`. Answers to unknown questions, and to
 * a follow-up whose choice is not picked, are dropped.
 */
export function surveySentProperties(
  active: ActiveUserSurvey,
  answers: ReadonlyArray<UserSurveyAnswer>,
  submissionId: string,
): Record<string, unknown> {
  const given = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  const responses = new Map<string, string | string[]>();
  for (const question of active.survey.questions) {
    const value = given.get(question.id);
    if (value === undefined) continue;
    if (question.showWhen) {
      const parent = active.survey.questions.find(
        (candidate) => candidate.id === question.showWhen?.questionId,
      );
      const picked = responses.get(question.showWhen.questionId);
      const pickedIndex =
        parent && parent.type !== "open" && typeof picked === "string"
          ? choiceIndex(parent.choices, parent.hasOpenChoice, picked)
          : -1;
      if (!question.showWhen.choices.includes(pickedIndex)) continue;
    }
    const response = answerValue(question, value);
    if (response !== null) responses.set(question.id, response);
  }
  return {
    ...surveyEventProperties(active),
    $survey_submission_id: submissionId,
    $survey_completed: true,
    $survey_questions: active.survey.questions.map((question) => ({
      id: question.id,
      question: question.question,
      response: responses.get(question.id) ?? null,
    })),
    ...Object.fromEntries(
      [...responses].map(([questionId, response]) => [`$survey_response_${questionId}`, response]),
    ),
  };
}
