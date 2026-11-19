import { assert, describe, it } from "@effect/vitest";

import { FEEDBACK_SURVEY, surveyResponseProperties } from "./UserSurveyDefinition.ts";

describe("surveyResponseProperties", () => {
  it("sends each answer under its question id, as posthog-js does", () => {
    assert.deepEqual(
      surveyResponseProperties(
        FEEDBACK_SURVEY,
        [
          { questionId: "working", value: "Something's off" },
          { questionId: "problem", value: "  The sidebar flickers  " },
          { questionId: "next", value: ["Voice dictation", "Calendar sync"] },
          { questionId: "contact", value: "" },
          { questionId: "unknown", value: "dropped" },
        ],
        "submission-1",
        { completed: true },
      ),
      {
        $survey_id: "feedback-2026-11",
        $survey_name: "Feedback, November 2026",
        $survey_submission_id: "submission-1",
        $survey_completed: true,
        $survey_questions: [
          {
            id: "working",
            question: "Hi 👋 Is Up.computer working well for you?",
            response: "Something's off",
          },
          {
            id: "problem",
            question: "What went wrong? We'll fix it as soon as we can.",
            response: "The sidebar flickers",
          },
          {
            id: "next",
            question: "What should we build next?",
            response: ["Voice dictation", "Calendar sync"],
          },
          {
            id: "contact",
            question: "Can we follow up with you? Leave your email or X handle.",
            response: null,
          },
        ],
        $survey_response_working: "Something's off",
        $survey_response_problem: "The sidebar flickers",
        $survey_response_next: ["Voice dictation", "Calendar sync"],
      },
    );
  });

  it("drops the problem answer when All good skips that question", () => {
    const properties = surveyResponseProperties(
      FEEDBACK_SURVEY,
      [
        { questionId: "working", value: "All good" },
        { questionId: "problem", value: "typed before switching to All good" },
      ],
      "submission-2",
      { completed: true },
    );
    assert.strictEqual(properties.$survey_response_working, "All good");
    assert.notProperty(properties, "$survey_response_problem");
  });

  it("marks the card's answer as partial, and a dismissal after it as partially completed", () => {
    const answers = [{ questionId: "working", value: "All good" }];
    const partial = surveyResponseProperties(FEEDBACK_SURVEY, answers, "submission-3", {
      completed: false,
    });
    assert.strictEqual(partial.$survey_completed, false);
    assert.strictEqual(partial.$survey_response_working, "All good");

    const dismissed = surveyResponseProperties(
      FEEDBACK_SURVEY,
      answers,
      "submission-3",
      "dismissed",
    );
    assert.strictEqual(dismissed.$survey_submission_id, "submission-3");
    assert.strictEqual(dismissed.$survey_partially_completed, true);
    assert.notProperty(dismissed, "$survey_completed");
  });
});
