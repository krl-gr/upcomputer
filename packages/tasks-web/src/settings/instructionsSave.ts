import {
  TASK_PROMPT_FIELDS,
  type InstructionsField,
  type TaskPromptSettings,
  type TaskPromptSettingsUpdateInput,
  type TaskPromptSettingsUpdateResult,
} from "@upcomputer/tasks-contracts/v1";

/** An All chats edit and the saved text it started from. */
export interface AllChatsDraft {
  readonly text: string;
  readonly base: string;
}

/**
 * The settings page save: only the fields edited on the page, each with the
 * text the page loaded as `base`, so the server refuses fields changed elsewhere.
 */
export function instructionsSaveInput(input: {
  readonly saved: TaskPromptSettings;
  readonly draft: TaskPromptSettings;
  readonly allChats?: AllChatsDraft | undefined;
}): TaskPromptSettingsUpdateInput {
  const texts: { [Field in InstructionsField]?: string } = {};
  const base: { [Field in InstructionsField]?: string } = {};
  for (const field of TASK_PROMPT_FIELDS) {
    if (input.draft[field] === input.saved[field]) continue;
    texts[field] = input.draft[field];
    base[field] = input.saved[field];
  }
  if (input.allChats) {
    texts.allChats = input.allChats.text;
    base.allChats = input.allChats.base;
  }
  return { ...texts, base };
}

/** The draft after a save: the current texts, except refused edits stay unsaved. */
export function draftAfterSave(
  draft: TaskPromptSettings,
  result: TaskPromptSettingsUpdateResult,
): TaskPromptSettings {
  const next = { ...draft };
  for (const field of TASK_PROMPT_FIELDS) {
    if (!result.conflicts.includes(field)) next[field] = result[field];
  }
  return next;
}
