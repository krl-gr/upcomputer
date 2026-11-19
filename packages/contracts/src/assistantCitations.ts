import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ASSISTANT_CITATION_MAX_TEXT_LENGTH = 8_000;
export const ASSISTANT_CITATION_MAX_COMMENT_LENGTH = 8_000;
export const ASSISTANT_CITATION_CONTEXT_LENGTH = 32;
// Provider message IDs nest and re-encode their thread and turn IDs, so they outgrow a few hundred characters.
export const ASSISTANT_CITATION_MAX_ID_LENGTH = 4_096;
export const ASSISTANT_CITATION_TASK_TITLE_LENGTH = 512;

const citationFields = {
  version: Schema.Literal(1),
  environmentId: EnvironmentId.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_ID_LENGTH)),
  text: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
  ),
  comment: Schema.optional(
    Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_COMMENT_LENGTH)),
  ),
  start: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  end: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
};
const isQuote = Schema.makeFilter(
  (citation: { readonly start: number; readonly end: number; readonly text: string }) =>
    citation.end > citation.start && citation.text.trim().length > 0,
);

/** A quote from an assistant response. Positions are UTF-16 offsets, not Markdown offsets. */
export const AssistantMessageCitation = Schema.Struct({
  ...citationFields,
  threadId: ThreadId.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_ID_LENGTH)),
  messageId: MessageId.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_ID_LENGTH)),
}).check(isQuote);
export type AssistantMessageCitation = typeof AssistantMessageCitation.Type;

/** UpComputer: a quote from a task's output. The title is the task's title when it was quoted. */
export const TaskOutputCitation = Schema.Struct({
  ...citationFields,
  taskId: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  taskTitle: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_TASK_TITLE_LENGTH)),
}).check(isQuote);
export type TaskOutputCitation = typeof TaskOutputCitation.Type;

export const AssistantCitation = Schema.Union([AssistantMessageCitation, TaskOutputCitation]);
export type AssistantCitation = typeof AssistantCitation.Type;

export function isTaskOutputCitation(citation: AssistantCitation): citation is TaskOutputCitation {
  return "taskId" in citation;
}
