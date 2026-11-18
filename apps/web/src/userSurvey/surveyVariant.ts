// Temporary, phase 1 of the survey redesign: three directions side by side.
// Pick one with ?survey=a|b|c; the choice sticks in this browser. Phase 2 removes it.

export type SurveyVariant = "dialog" | "inline" | "steps";

const STORAGE_KEY = "upcomputer:dev:survey-variant";
const BY_LETTER: Record<string, SurveyVariant> = { a: "dialog", b: "inline", c: "steps" };

function readSurveyVariant(): SurveyVariant {
  try {
    const asked = new URLSearchParams(window.location.search).get("survey")?.toLowerCase();
    if (asked && BY_LETTER[asked]) window.localStorage.setItem(STORAGE_KEY, asked);
    return BY_LETTER[window.localStorage.getItem(STORAGE_KEY) ?? "a"] ?? "dialog";
  } catch {
    return "dialog";
  }
}

// Read as the app loads: the router drops the query before the sidebar mounts.
export const SURVEY_VARIANT = readSurveyVariant();

// Temporary, phase 1b: the popover card's layouts. Pick one with ?surveyCard=1|2|3 (0 is the X and Share).
export type SurveyCardLayout = "corner" | "link" | "buttons" | "whole";

const CARD_STORAGE_KEY = "upcomputer:dev:survey-card";
const CARD_BY_NUMBER: Record<string, SurveyCardLayout> = {
  "0": "corner",
  "1": "link",
  "2": "buttons",
  "3": "whole",
};

function readSurveyCardLayout(): SurveyCardLayout {
  try {
    const asked = new URLSearchParams(window.location.search).get("surveyCard");
    if (asked && CARD_BY_NUMBER[asked]) window.localStorage.setItem(CARD_STORAGE_KEY, asked);
    return CARD_BY_NUMBER[window.localStorage.getItem(CARD_STORAGE_KEY) ?? "1"] ?? "link";
  } catch {
    return "link";
  }
}

const SURVEY_CARD_LAYOUT = readSurveyCardLayout();

/** A function, so the UI states sheet can draw every layout. */
export function surveyCardLayout(): SurveyCardLayout {
  return SURVEY_CARD_LAYOUT;
}
