import * as Schema from "effect/Schema";

import { ProjectConfigFile, PROJECT_CONFIG_FILE_SCHEMA_URL } from "@upcomputer/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `upcomputer.json` file contents (lenient JSONC string) and the
 * decoded {@link ProjectConfigFile}.
 */
export const ProjectConfigFileFromJson = fromLenientJson(ProjectConfigFile);

/**
 * Build the publishable JSON Schema document for `upcomputer.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link PROJECT_CONFIG_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildProjectConfigFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(ProjectConfigFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: PROJECT_CONFIG_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
