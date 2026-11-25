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

/** The choice that takes the person's own words. */
export function isOpenChoice(question: ChoiceQuestion, index: number): boolean {
  return question.choices[index]?.kind === "own-answer";
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
    return [isOpenChoice(question, index) ? answer.otherText.trim() || choice.label : choice.label];
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
  return first?.type === "single_choice" &&
    first.choices.length <= 3 &&
    first.choices.every((choice) => choice.kind === undefined)
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
  return question.type === "open" && question.kind === "contact";
}

/** The card is not a step of the form: confirming it confirms the card's question. */
export type SurveyConfirmedStep = number | "card";

/**
 * The questions confirmed once the card's question is answered or a step is
 * left with Continue or Skip: that step's question and its follow-ups.
 */
export function confirmSurveyStep(
  survey: UserSurvey,
  draft: SurveyDraft,
  confirmed: ReadonlySet<string>,
  step: SurveyConfirmedStep,
): ReadonlySet<string> {
  const questions =
    step === "card"
      ? [surveyCardQuestion(survey)].filter((question) => question !== null)
      : [surveySteps(survey, draft)[step]].flatMap((block) =>
          block ? [block.question, ...block.followUps] : [],
        );
  return new Set([...confirmed, ...questions.map((question) => question.id)]);
}

/** Answers to confirmed questions: text typed on a step the person did not leave forward stays out. */
export function confirmedSurveyAnswers(
  survey: UserSurvey,
  draft: SurveyDraft,
  confirmed: ReadonlySet<string>,
): ReadonlyArray<UserSurveyAnswer> {
  return surveyAnswers(survey, draft).filter((answer) => confirmed.has(answer.questionId));
}

/**
 * The step the person left on, for a drop-off funnel: the card's question
 * (index 0) until it is answered, then the form's step, counted after the card.
 */
export function surveyLeftOn(
  survey: UserSurvey,
  draft: SurveyDraft,
  step: number,
): { readonly questionId: string; readonly index: number } {
  const card = surveyCardQuestion(survey);
  if (card && !draft[card.id]?.picked.length) return { questionId: card.id, index: 0 };
  const steps = surveySteps(survey, draft);
  const at = Math.max(0, Math.min(step, steps.length - 1));
  return { questionId: steps[at]!.question.id, index: at + (card ? 1 : 0) };
}
