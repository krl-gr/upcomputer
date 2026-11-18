import type { UserSurvey, UserSurveyAnswer, UserSurveyQuestion } from "@t3tools/contracts";

/** What the person has entered for one question so far. */
export interface SurveyDraftAnswer {
  /** Picked choice indexes; at most one for a single-choice question. */
  readonly picked: ReadonlyArray<number>;
  /** The open choice's own words. */
  readonly otherText: string;
  /** An open question's answer. */
  readonly text: string;
}

export type SurveyDraft = Readonly<Record<string, SurveyDraftAnswer>>;

export const EMPTY_DRAFT_ANSWER: SurveyDraftAnswer = { picked: [], otherText: "", text: "" };

export type ChoiceQuestion = Extract<UserSurveyQuestion, { readonly choices: unknown }>;

export function isOpenChoice(question: ChoiceQuestion, index: number): boolean {
  return question.hasOpenChoice && index === question.choices.length - 1;
}

function draftAnswer(draft: SurveyDraft, questionId: string): SurveyDraftAnswer {
  return draft[questionId] ?? EMPTY_DRAFT_ANSWER;
}

function isShown(question: UserSurveyQuestion, draft: SurveyDraft): boolean {
  const showWhen = question.showWhen;
  if (!showWhen) return true;
  return draftAnswer(draft, showWhen.questionId).picked.some((index) =>
    showWhen.choices.includes(index),
  );
}

/**
 * The form's blocks: each top-level question with the follow-ups its picked
 * choice shows, drawn right under it.
 */
export function surveyBlocks(
  survey: UserSurvey,
  draft: SurveyDraft,
): ReadonlyArray<{
  readonly question: UserSurveyQuestion;
  readonly followUps: ReadonlyArray<UserSurveyQuestion>;
}> {
  const ids = new Set(survey.questions.map((question) => question.id));
  const isFollowUp = (question: UserSurveyQuestion) =>
    question.showWhen !== undefined && ids.has(question.showWhen.questionId);
  return survey.questions
    .filter((question) => !isFollowUp(question))
    .map((question) => ({
      question,
      followUps: survey.questions.filter(
        (candidate) => candidate.showWhen?.questionId === question.id && isShown(candidate, draft),
      ),
    }));
}

function answerValue(
  question: UserSurveyQuestion,
  answer: SurveyDraftAnswer,
): UserSurveyAnswer["value"] | null {
  if (question.type === "open") return answer.text.trim() || null;
  const values = question.choices.flatMap((choice, index) => {
    if (!answer.picked.includes(index)) return [];
    return [isOpenChoice(question, index) ? answer.otherText.trim() || choice : choice];
  });
  if (values.length === 0) return null;
  return question.type === "single_choice" ? values[0]! : values;
}

/** Answers to the questions on screen; a hidden follow-up's text is not sent. */
export function surveyAnswers(
  survey: UserSurvey,
  draft: SurveyDraft,
): ReadonlyArray<UserSurveyAnswer> {
  return survey.questions.flatMap((question) => {
    if (!isShown(question, draft)) return [];
    const value = answerValue(question, draftAnswer(draft, question.id));
    return value === null ? [] : [{ questionId: question.id, value }];
  });
}

/** Something is answered and no required question on screen is left empty. */
export function canSubmitSurvey(survey: UserSurvey, draft: SurveyDraft): boolean {
  const answered = new Set(surveyAnswers(survey, draft).map((answer) => answer.questionId));
  return (
    answered.size > 0 &&
    survey.questions.every(
      (question) => question.optional || !isShown(question, draft) || answered.has(question.id),
    )
  );
}

/** The draft after ticking or picking choice `index`. */
export function pickChoice(
  question: ChoiceQuestion,
  answer: SurveyDraftAnswer,
  index: number,
  checked: boolean,
): SurveyDraftAnswer {
  if (question.type === "single_choice") return { ...answer, picked: [index] };
  const picked = checked
    ? [...new Set([...answer.picked, index])].toSorted((left, right) => left - right)
    : answer.picked.filter((current) => current !== index);
  return { ...answer, picked };
}

/**
 * The first question, when the notification card can ask it itself: a single
 * choice short enough to sit in the card as chips.
 */
export function surveyCardQuestion(survey: UserSurvey): ChoiceQuestion | null {
  const first = surveyBlocks(survey, {})[0]?.question;
  return first?.type === "single_choice" && !first.hasOpenChoice && first.choices.length <= 3
    ? first
    : null;
}

/**
 * The form's steps. The card answers a first question it can ask, so that
 * question is not asked again and its follow-ups become steps of their own.
 * Otherwise every block is a step.
 */
export function surveySteps(
  survey: UserSurvey,
  draft: SurveyDraft,
): ReturnType<typeof surveyBlocks> {
  const blocks = surveyBlocks(survey, draft);
  if (!surveyCardQuestion(survey)) return blocks;
  const [first, ...rest] = blocks;
  const steps = [...first!.followUps.map((question) => ({ question, followUps: [] })), ...rest];
  return steps.length > 0 ? steps : blocks;
}

/**
 * Whether an answer opened a follow-up question: the person reported something
 * to look into. Read from the branching, so it holds for any wording.
 */
export function surveyOpenedFollowUp(survey: UserSurvey, draft: SurveyDraft): boolean {
  return survey.questions.some(
    (question) => question.showWhen !== undefined && isShown(question, draft),
  );
}

/** An open question that asks how to reach the person: one line, not a text box. */
export function isContactQuestion(question: UserSurveyQuestion): boolean {
  return question.type === "open" && /e-?mail/i.test(question.question);
}
