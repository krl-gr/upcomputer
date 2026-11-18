import { assert, describe, it } from "@effect/vitest";

import fixture from "./fixtures/posthogSurveys.json" with { type: "json" };
import {
  parseUserSurveys,
  selectUserSurvey,
  surveySentProperties,
} from "./UserSurveyDefinition.ts";

const IMPROVE_ID = "0199a1b2-0000-7000-8000-000000000001";
const improve = fixture.surveys[0]!;

function apiSurvey(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    type: "api",
    start_date: "2026-11-01T00:00:00Z",
    end_date: null,
    questions: [{ id: `${id}-q`, type: "open", question: "Why?" }],
    ...overrides,
  };
}

describe("parseUserSurveys", () => {
  it("reads the PostHog survey as the form draws it", () => {
    const [active, ...rest] = parseUserSurveys(fixture);
    assert.deepEqual(rest, []);
    assert.deepEqual(active, {
      survey: {
        id: IMPROVE_ID,
        name: "How can we improve Up.computer",
        questions: [
          {
            id: "q-working",
            question: "Hi 👋 Is Up.computer working well for you?",
            optional: false,
            type: "single_choice",
            choices: ["All good", "Something's off"],
            hasOpenChoice: false,
          },
          {
            id: "q-details",
            question: "What went wrong? We'll fix it as soon as we can.",
            description: "What happened, and where in the app?",
            optional: true,
            // "All good" skips to question 2, so the details question follows "Something's off".
            showWhen: { questionId: "q-working", choices: [1] },
            type: "open",
          },
          {
            id: "q-missing",
            question: "What should we build next?",
            optional: true,
            type: "multiple_choice",
            choices: [
              "Mobile app",
              "Cloud agents",
              "Voice dictation",
              "Bots in Slack",
              "Bots in video calls",
              "Document editing",
              "Collaborative work",
              "Other",
            ],
            hasOpenChoice: true,
          },
          {
            id: "q-else",
            question: "Can we follow up with you? Leave your email or X handle.",
            optional: true,
            type: "open",
          },
        ],
      },
      key: IMPROVE_ID,
      startDate: "2026-11-18T10:00:00Z",
      iteration: null,
      iterationStartDate: null,
    });
  });

  it("leaves out question types it cannot draw, and surveys left with none", () => {
    const parsed = parseUserSurveys({
      surveys: [
        apiSurvey("mixed", {
          questions: [
            { id: "rate", type: "rating", question: "Rate us", scale: 5, display: "number" },
            { id: "link", type: "link", question: "Read more", link: "https://example.com" },
            { id: "future", type: "matrix", question: "Something new" },
            { id: "no-choices", type: "single_choice", question: "Pick", choices: [] },
            { id: "kept", type: "open", question: "Tell us", description: "<b>hi</b>" },
            "not a question",
          ],
        }),
        apiSurvey("only-rating", {
          questions: [{ id: "rate", type: "rating", question: "Rate", scale: 5 }],
        }),
      ],
    });
    assert.deepEqual(
      parsed.map((active) => active.survey.questions.map((question) => question.id)),
      [["kept"]],
    );
    assert.strictEqual(parsed[0]!.survey.questions[0]!.description, "<b>hi</b>");
  });

  it("offers only started, unended API surveys without flag targeting", () => {
    const parsed = parseUserSurveys({
      surveys: [
        apiSurvey("live"),
        apiSurvey("popover", { type: "popover" }),
        apiSurvey("draft", { start_date: null }),
        apiSurvey("ended", { end_date: "2026-11-10T00:00:00Z" }),
        apiSurvey("flagged", { linked_flag_key: "beta" }),
        apiSurvey("targeted", { targeting_flag_key: "survey-targeting-x" }),
        apiSurvey("iterated", { current_iteration: 3, current_iteration_start_date: "2026-11-15" }),
        { id: "broken" },
      ],
    });
    assert.deepEqual(
      parsed.map((active) => active.key),
      ["live", "iterated_3"],
    );
  });

  it("does not draw a follow-up when no choice skips past it", () => {
    const parsed = parseUserSurveys({
      surveys: [
        apiSurvey("plain", {
          questions: [
            {
              ...improve.questions[0],
              branching: { type: "response_based", responseValues: { "0": "end" } },
            },
            improve.questions[1],
          ],
        }),
        apiSurvey("all-next", {
          questions: [
            { ...improve.questions[0], branching: { type: "next_question" } },
            improve.questions[1],
          ],
        }),
      ],
    });
    // "end" skips past the details question too, so it still follows "Something's off".
    assert.deepEqual(parsed[0]!.survey.questions[1]!.showWhen, {
      questionId: "q-working",
      choices: [1],
    });
    assert.isUndefined(parsed[1]!.survey.questions[1]!.showWhen);
  });

  it("returns nothing for a body that is not a surveys response", () => {
    assert.deepEqual(parseUserSurveys({ detail: "Invalid token" }), []);
    assert.deepEqual(parseUserSurveys(null), []);
  });
});

describe("selectUserSurvey", () => {
  const surveys = parseUserSurveys({
    surveys: [
      apiSurvey("older", { start_date: "2026-11-01T00:00:00Z" }),
      apiSurvey("newer", { start_date: "2026-11-10T00:00:00Z" }),
      apiSurvey("again", { current_iteration: 2, start_date: "2026-11-05T00:00:00Z" }),
    ],
  });
  const pick = (handled: ReadonlyArray<string>) =>
    selectUserSurvey(surveys, new Set(handled))?.key ?? null;

  it("offers the newest survey this install has not answered or dismissed", () => {
    assert.strictEqual(pick([]), "newer");
    assert.strictEqual(pick(["newer"]), "again_2");
    assert.strictEqual(pick(["newer", "again_2"]), "older");
    assert.strictEqual(pick(["newer", "again_2", "older"]), null);
  });

  it("asks again in a new iteration of an answered survey", () => {
    assert.strictEqual(pick(["newer", "again", "again_1"]), "again_2");
  });
});

describe("surveySentProperties", () => {
  const active = parseUserSurveys(fixture)[0]!;

  it("sends each answer under its question id, as posthog-js does", () => {
    assert.deepEqual(
      surveySentProperties(
        active,
        [
          { questionId: "q-working", value: "Something's off" },
          { questionId: "q-details", value: "  The sidebar flickers  " },
          { questionId: "q-missing", value: ["Voice dictation", "Calendar sync"] },
          { questionId: "q-else", value: "" },
          { questionId: "q-unknown", value: "dropped" },
        ],
        "submission-1",
      ),
      {
        $survey_id: IMPROVE_ID,
        $survey_name: "How can we improve Up.computer",
        $survey_submission_id: "submission-1",
        $survey_completed: true,
        $survey_questions: [
          {
            id: "q-working",
            question: "Hi 👋 Is Up.computer working well for you?",
            response: "Something's off",
          },
          {
            id: "q-details",
            question: "What went wrong? We'll fix it as soon as we can.",
            response: "The sidebar flickers",
          },
          {
            id: "q-missing",
            question: "What should we build next?",
            response: ["Voice dictation", "Calendar sync"],
          },
          {
            id: "q-else",
            question: "Can we follow up with you? Leave your email or X handle.",
            response: null,
          },
        ],
        "$survey_response_q-working": "Something's off",
        "$survey_response_q-details": "The sidebar flickers",
        "$survey_response_q-missing": ["Voice dictation", "Calendar sync"],
      },
    );
  });

  it("drops a follow-up answer once its choice is no longer picked", () => {
    const properties = surveySentProperties(
      active,
      [
        { questionId: "q-working", value: "All good" },
        { questionId: "q-details", value: "typed before switching to All good" },
      ],
      "submission-2",
    );
    assert.strictEqual(properties["$survey_response_q-working"], "All good");
    assert.notProperty(properties, "$survey_response_q-details");
  });

  it("tags an iterated survey's events with its iteration", () => {
    const [iterated] = parseUserSurveys({
      surveys: [
        apiSurvey("iterated", { current_iteration: 2, current_iteration_start_date: "2026-11-15" }),
      ],
    });
    const properties = surveySentProperties(iterated!, [], "submission-3");
    assert.strictEqual(properties.$survey_iteration, 2);
    assert.strictEqual(properties.$survey_iteration_start_date, "2026-11-15");
  });
});
