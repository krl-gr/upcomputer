import { ProjectReadFileError } from "@upcomputer/contracts";
import * as Schema from "effect/Schema";

/** A new server proves absence explicitly; never infer it from a search index or an error message. */
const isReadError = Schema.is(ProjectReadFileError);
export function isMissingProjectConfigFile(error: unknown): boolean {
  return isReadError(error) && error.notFound === true;
}
