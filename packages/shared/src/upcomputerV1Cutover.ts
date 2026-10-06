import * as Schema from "effect/Schema";

/**
 * The state of the one-time move of an UpComputer V1 home onto v2, kept in
 * the userdata folder next to the databases. The server writes it while it
 * runs the cutover; the desktop reads it to show the upgrade and its failure.
 */
export const V1_CUTOVER_STATE_FILE = "v1-cutover.json";

/** The process running a cutover: its pid, and when it started, so a reused pid is told apart. */
export const V1CutoverOwner = Schema.Struct({
  pid: Schema.Number,
  startedAt: Schema.String,
});

export const V1CutoverState = Schema.Struct({
  status: Schema.Literals(["running", "completed", "failed"]),
  /** One attempt; its staging database is named after it. Absent in states older builds wrote. */
  runId: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(V1CutoverOwner),
  startedAt: Schema.String,
  finishedAt: Schema.optionalKey(Schema.String),
  backupDir: Schema.String,
  restoreCommand: Schema.optionalKey(Schema.String),
  reportPath: Schema.optionalKey(Schema.String),
  /** Why a failed cutover stopped. */
  message: Schema.optionalKey(Schema.String),
});
export type V1CutoverState = typeof V1CutoverState.Type;
