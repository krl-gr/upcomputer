import { assert, describe, test } from "vite-plus/test";

import {
  INSTRUCTION_UPDATES,
  instructionUpdatesBrief,
  instructionUpdatesBriefName,
} from "./instructionUpdates.ts";
import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  LEGACY_TASK_PROMPT_SETTINGS,
  TASK_PROMPT_FIELDS,
} from "./prompts.ts";
import { CURRENT_TASK_WORKFLOW_VERSION, LEGACY_TASK_STATUSES, TASK_STATUSES } from "./tasks.ts";

describe("the registry", () => {
  test("ids are unique", () => {
    const ids = INSTRUCTION_UPDATES.map((entry) => entry.id);
    assert.deepStrictEqual(ids, [...new Set(ids)]);
  });

  // A default that changes without an entry would reach no existing install,
  // and an entry edited after shipping would describe a change nobody got.
  test("each prompt's changes chain from workflow 1's text to today's default", () => {
    for (const field of TASK_PROMPT_FIELDS) {
      let text = LEGACY_TASK_PROMPT_SETTINGS[field];
      for (const entry of INSTRUCTION_UPDATES) {
        for (const change of entry.changes) {
          if (change.kind !== "prompt" || change.field !== field) continue;
          assert.strictEqual(change.before, text, `${entry.id} ${field} before`);
          text = change.after;
        }
      }
      assert.strictEqual(text, DEFAULT_TASK_PROMPT_SETTINGS[field], `${field} ends at the default`);
    }
  });

  test("the statuses chain from workflow 1's list to today's", () => {
    let statuses: ReadonlyArray<string> = LEGACY_TASK_STATUSES;
    for (const entry of INSTRUCTION_UPDATES) {
      for (const change of entry.changes) {
        if (change.kind !== "statuses") continue;
        assert.deepStrictEqual(change.before, statuses, entry.id);
        statuses = change.after;
      }
      for (const [from, to] of Object.entries(entry.statusRenames ?? {})) {
        assert.include(statuses, to, `${entry.id} renames ${from} to a listed status`);
      }
    }
    assert.deepStrictEqual(statuses, TASK_STATUSES);
  });

  test("the last workflow version an entry moves to is the current one", () => {
    const versions = INSTRUCTION_UPDATES.flatMap((entry) =>
      entry.workflowVersion === undefined ? [] : [entry.workflowVersion],
    );
    assert.strictEqual(versions.at(-1), CURRENT_TASK_WORKFLOW_VERSION);
  });

  test("shipped copy has no em dashes", () => {
    assert.notInclude(JSON.stringify(INSTRUCTION_UPDATES), "—");
  });
});

describe("the brief", () => {
  const [statuses] = INSTRUCTION_UPDATES;
  const brief = instructionUpdatesBrief([statuses!]);

  test("asks the bot to change nothing until the user agrees, and to close the entry", () => {
    assert.include(brief, "Change nothing until the user agrees");
    assert.include(
      brief,
      'Call instruction_update_decide with id "task-statuses-v2" and state "applied"',
    );
    assert.include(brief, 'with state "kept" instead');
  });

  test("carries why, both texts of each change and the status mapping", () => {
    assert.include(brief, statuses!.why);
    assert.include(brief, LEGACY_TASK_PROMPT_SETTINGS.taskExecution);
    assert.include(brief, DEFAULT_TASK_PROMPT_SETTINGS.taskExecution);
    assert.include(brief, "- Backlog -> Queued");
    assert.include(brief, "New: Failed");
    assert.include(brief, "Before: off. After: on.");
  });

  test("looks at the user's setup first and applies with the tools", () => {
    for (const tool of [
      "instruction_updates_get",
      "task_search",
      "agent_search",
      "instructions_get",
      "automation_search",
      "task_status_rename",
      "agent_update",
      "instructions_update",
      "task_list_settings_update",
      "task_workflow_version_set",
    ]) {
      assert.include(brief, tool);
    }
    assert.isBelow(
      brief.indexOf("## Look first"),
      brief.indexOf("## Apply, after the user agrees"),
    );
  });

  test("several entries share one frame", () => {
    const both = instructionUpdatesBrief([statuses!, { ...statuses!, id: "other" }]);
    assert.strictEqual(both.match(/## How to work/g)?.length, 1);
    assert.include(both, 'id "other"');
    assert.strictEqual(instructionUpdatesBriefName([statuses!]), "Task statuses update.md");
    assert.strictEqual(
      instructionUpdatesBriefName([statuses!, statuses!]),
      "2 instruction updates.md",
    );
  });
});
