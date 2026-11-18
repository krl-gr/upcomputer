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
