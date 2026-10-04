import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

export class TaskPersistenceSqlError extends Schema.TaggedError<TaskPersistenceSqlError>()(
  "TaskPersistenceSqlError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Task persistence SQL error in ${this.operation}: ${this.detail}`;
  }
}

export class TaskPersistenceDecodeError extends Schema.TaggedError<TaskPersistenceDecodeError>()(
  "TaskPersistenceDecodeError",
  {
    operation: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Task persistence decode error in ${this.operation}: ${this.issue}`;
  }
}

export type TaskRepositoryError = TaskPersistenceSqlError | TaskPersistenceDecodeError;

export function toTaskPersistenceSqlError(operation: string) {
  return (cause: unknown): TaskPersistenceSqlError =>
    new TaskPersistenceSqlError({
      operation,
      detail: `Failed to execute ${operation}`,
      cause,
    });
}

export function toTaskPersistenceDecodeError(operation: string) {
  return (error: Schema.SchemaError): TaskPersistenceDecodeError =>
    new TaskPersistenceDecodeError({
      operation,
      issue: SchemaIssue.makeFormatterDefault()(error.issue),
      cause: error,
    });
}
