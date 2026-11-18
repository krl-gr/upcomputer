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
      choices: ["Yes", "There are issues"],
      hasOpenChoice: false,
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
      choices: ["Mobile app", "Voice", "Other"],
      hasOpenChoice: true,
    },
    { id: "else", type: "open", question: "Anything else?", optional: true },
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
