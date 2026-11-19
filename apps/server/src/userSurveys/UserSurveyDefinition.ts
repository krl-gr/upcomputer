/**
 * The survey this release asks, and its events as posthog-js sends them
 * (`survey shown`, `survey sent`, `survey dismissed` in `@posthog/core`).
 */
import type { UserSurvey, UserSurveyAnswer, UserSurveyQuestion } from "@t3tools/contracts";

/** A new survey ships under a new id: answers and dismissals are remembered per id. */
export const FEEDBACK_SURVEY: UserSurvey = {
  id: "feedback-2026-11",
  name: "Feedback, November 2026",
  questions: [
    {
      id: "working",
      type: "single_choice",
      question: "Hi 👋 Is Up.computer working well for you?",
      optional: false,
      choices: [{ label: "All good" }, { label: "Something's off" }],
    },
    {
      id: "problem",
      type: "open",
      question: "What went wrong? We'll fix it as soon as we can.",
      placeholder: "What happened, and where in the app?",
      optional: true,
      // "All good" skips it.
      showWhen: { questionId: "working", choices: [1] },
    },
    {
      id: "next",
      type: "multiple_choice",
      question: "What should we build next?",
      optional: true,
      choices: [
        { label: "iOS app" },
        { label: "Android app" },
        { label: "Cloud agents" },
        { label: "Voice dictation" },
        { label: "Bots in Slack" },
        { label: "Bots in video calls" },
        { label: "Collaborative work" },
        { label: "Write my own", kind: "own-answer" },
      ],
    },
    {
      id: "contact",
      type: "open",
      kind: "contact",
      question: "Can we follow up with you? Leave your email or X handle.",
      optional: true,
    },
  ],
};

/** What every survey event carries. */
export function surveyEventProperties(survey: UserSurvey): Record<string, unknown> {
  return { $survey_id: survey.id, $survey_name: survey.name };
}

/** Any text that is not a listed choice is the own-answer choice's words. */
function choiceIndex(question: UserSurveyQuestion, picked: string): number {
  if (question.type === "open") return -1;
  const index = question.choices.findIndex((choice) => choice.label === picked);
  return index === -1
    ? question.choices.findIndex((choice) => choice.kind === "own-answer")
    : index;
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
 * The responses for `answers`. Answers to unknown questions, and to a
 * follow-up whose choice is not picked, are dropped.
 */
function surveyResponses(
  survey: UserSurvey,
  answers: ReadonlyArray<UserSurveyAnswer>,
): ReadonlyMap<string, string | string[]> {
  const given = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  const responses = new Map<string, string | string[]>();
  for (const question of survey.questions) {
    const value = given.get(question.id);
    if (value === undefined) continue;
    const showWhen = question.showWhen;
    if (showWhen) {
      const parent = survey.questions.find((candidate) => candidate.id === showWhen.questionId);
      const picked = responses.get(showWhen.questionId);
      const pickedIndex = parent && typeof picked === "string" ? choiceIndex(parent, picked) : -1;
      if (!showWhen.choices.includes(pickedIndex)) continue;
    }
    const response = answerValue(question, value);
    if (response !== null) responses.set(question.id, response);
  }
  return responses;
}

/**
 * The answers as posthog-js sends them: a partial response when the card's
 * question is answered (`completed: false`), the full one on Send, and the
 * answers so far on a dismissal. One `submissionId` ties them together.
 */
export function surveyResponseProperties(
  survey: UserSurvey,
  answers: ReadonlyArray<UserSurveyAnswer>,
  submissionId: string,
  event: { readonly completed: boolean } | "dismissed",
): Record<string, unknown> {
  const responses = surveyResponses(survey, answers);
  return {
    ...surveyEventProperties(survey),
    $survey_submission_id: submissionId,
    ...(event === "dismissed"
      ? { $survey_partially_completed: responses.size > 0 }
      : { $survey_completed: event.completed }),
    $survey_questions: survey.questions.map((question) => ({
      id: question.id,
      question: question.question,
      response: responses.get(question.id) ?? null,
    })),
    ...Object.fromEntries(
      [...responses].map(([questionId, response]) => [`$survey_response_${questionId}`, response]),
    ),
  };
}
