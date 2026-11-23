import { assert, it } from "@effect/vitest";
import { DEFAULT_TASK_PROMPT_SETTINGS, instructionUpdateById } from "@t3tools/tasks-contracts/v1";

import { editedTextOf } from "./instructionUpdateRules.ts";

const workerMentions = (instructions: string) =>
  editedTextOf(instructionUpdateById("task-statuses-v2")!, {
    prompts: DEFAULT_TASK_PROMPT_SETTINGS,
    allChats: "",
    projects: [],
    workers: [{ id: "w", name: "Worker", instructions }],
  }).mentions.flatMap((mention) => mention.statuses);

it("a status mention is the whole status name, not a file name or the plain word", () => {
  const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["Hand off the bottom Backlog task when done.", ["Backlog"]],
    ['Finish in "Needs Review", or Needs input when stuck.', ["Needs Input", "Needs Review"]],
    ["Move it to Needs\nReview.", ["Needs Review"]],
    ["Keep the list in BACKLOG.md and docs/Backlog.md.", []],
    ["Groom the backlog every morning.", []],
    ["Read backlog_items and the Backlogs page.", []],
  ];
  for (const [instructions, statuses] of cases) {
    assert.deepStrictEqual(workerMentions(instructions), statuses, instructions);
  }
});
