import type { UserSurvey } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canSubmitSurvey,
  type ChoiceQuestion,
  EMPTY_DRAFT_ANSWER,
  pickChoice,
  type SurveyDraft,
  surveyAnswers,
  surveyBlocks,
  confirmedSurveyAnswers,
  confirmSurveyStep,
  surveyLeftOn,
  surveyOpenedFollowUp,
  surveySteps,
} from "./userSurvey.logic";

const SURVEY: UserSurvey = {
  id: "survey-1",
  name: "Improve",
  questions: [
    {
      id: "working",
      type: "single_choice",
      question: "Is everything working as expected?",
      optional: false,
      choices: [{ label: "Yes" }, { label: "There are issues" }],
    },
    {
      id: "details",
      type: "open",
      question: "Can you provide details?",
      optional: true,
      showWhen: { questionId: "working", choices: [1] },
    },
    {
      id: "missing",
      type: "multiple_choice",
      question: "What are you missing?",
      optional: true,
      choices: [
        { label: "Mobile app" },
        { label: "Voice" },
        { label: "Other", kind: "own-answer" },
      ],
    },
    { id: "else", type: "open", kind: "contact", question: "Your email?", optional: true },
  ],
};
const MISSING = SURVEY.questions[2] as ChoiceQuestion;

const answer = (overrides: Partial<typeof EMPTY_DRAFT_ANSWER>) => ({
  ...EMPTY_DRAFT_ANSWER,
  ...overrides,
});

describe("surveyBlocks", () => {
  const blockIds = (draft: SurveyDraft) =>
    surveyBlocks(SURVEY, draft).map(({ question, followUps }) => [
      question.id,
      followUps.map((followUp) => followUp.id),
    ]);

  it("draws the details question under its choice only while that choice is picked", () => {
    expect(blockIds({})).toEqual([
      ["working", []],
      ["missing", []],
      ["else", []],
    ]);
    expect(blockIds({ working: answer({ picked: [1] }) })[0]).toEqual(["working", ["details"]]);
    expect(blockIds({ working: answer({ picked: [0] }) })[0]).toEqual(["working", []]);
  });
});

describe("surveySteps", () => {
  const stepIds = (draft: SurveyDraft) =>
    surveySteps(SURVEY, draft).map(({ question }) => question.id);

  it("leaves the card's question out, and Yes skips the details step", () => {
    expect(stepIds({ working: answer({ picked: [0] }) })).toEqual(["missing", "else"]);
    expect(surveyOpenedFollowUp(SURVEY, { working: answer({ picked: [0] }) })).toBe(false);
    expect(stepIds({ working: answer({ picked: [1] }) })).toEqual(["details", "missing", "else"]);
    expect(surveyOpenedFollowUp(SURVEY, { working: answer({ picked: [1] }) })).toBe(true);
  });
});

describe("confirmedSurveyAnswers", () => {
  it("sends every answer confirmed so far, never text typed on the step left open", () => {
    const draft: SurveyDraft = {
      working: answer({ picked: [1] }),
      details: answer({ text: "Sidebar flickers" }),
      missing: answer({ picked: [1] }),
    };
    const card = confirmSurveyStep(SURVEY, draft, new Set(), "card");
    expect(confirmedSurveyAnswers(SURVEY, draft, card)).toEqual([
      { questionId: "working", value: "There are issues" },
    ]);
    // Continue on the details step; the choices typed on the next step stay out.
    const details = confirmSurveyStep(SURVEY, draft, card, 0);
    expect(confirmedSurveyAnswers(SURVEY, draft, details)).toEqual([
      { questionId: "working", value: "There are issues" },
      { questionId: "details", value: "Sidebar flickers" },
    ]);
    // Skip passes the step too; switching the card to Yes drops the hidden details.
    const missing = confirmSurveyStep(SURVEY, draft, details, 1);
    const yes = { ...draft, working: answer({ picked: [0] }) };
    expect(confirmedSurveyAnswers(SURVEY, yes, missing)).toEqual([
      { questionId: "working", value: "Yes" },
      { questionId: "missing", value: ["Voice"] },
    ]);
  });
});

describe("surveyLeftOn", () => {
  it("is the card's question until it is answered, then the form's step after the card", () => {
    expect(surveyLeftOn(SURVEY, {}, 0)).toEqual({ questionId: "working", index: 0 });
    const issues = { working: answer({ picked: [1] }) };
    expect(surveyLeftOn(SURVEY, issues, 0)).toEqual({ questionId: "details", index: 1 });
    expect(surveyLeftOn(SURVEY, issues, 2)).toEqual({ questionId: "else", index: 3 });
    // Yes skips the details step.
    const yes = { working: answer({ picked: [0] }) };
    expect(surveyLeftOn(SURVEY, yes, 0)).toEqual({ questionId: "missing", index: 1 });
  });
});

describe("surveyAnswers", () => {
  it("sends the open choice's own words and leaves out empty answers", () => {
    expect(
      surveyAnswers(SURVEY, {
        working: answer({ picked: [1] }),
        details: answer({ text: "  Sidebar flickers " }),
        missing: answer({ picked: [1, 2], otherText: " Calendar sync " }),
        else: answer({ text: "   " }),
      }),
    ).toEqual([
      { questionId: "working", value: "There are issues" },
      { questionId: "details", value: "Sidebar flickers" },
      { questionId: "missing", value: ["Voice", "Calendar sync"] },
    ]);
  });

  it("sends the open choice's label when nothing was typed for it", () => {
    expect(surveyAnswers(SURVEY, { missing: answer({ picked: [2] }) })).toEqual([
      { questionId: "missing", value: ["Other"] },
    ]);
  });

  it("does not send details typed before switching to Yes", () => {
    expect(
      surveyAnswers(SURVEY, {
        working: answer({ picked: [0] }),
        details: answer({ text: "typed earlier" }),
      }),
    ).toEqual([{ questionId: "working", value: "Yes" }]);
  });
});

describe("canSubmitSurvey", () => {
  it("waits for the required question and for something to send", () => {
    expect(canSubmitSurvey(SURVEY, {})).toBe(false);
    expect(canSubmitSurvey(SURVEY, { else: answer({ text: "Hi" }) })).toBe(false);
    expect(canSubmitSurvey(SURVEY, { working: answer({ picked: [0] }) })).toBe(true);
  });
});

describe("pickChoice", () => {
  it("toggles multiple choices in order and replaces a single choice", () => {
    const ticked = pickChoice(MISSING, pickChoice(MISSING, EMPTY_DRAFT_ANSWER, 2, true), 0, true);
    expect(ticked.picked).toEqual([0, 2]);
    expect(pickChoice(MISSING, ticked, 2, false).picked).toEqual([0]);
    const working = SURVEY.questions[0] as ChoiceQuestion;
    expect(pickChoice(working, answer({ picked: [0] }), 1, true).picked).toEqual([1]);
  });
});
