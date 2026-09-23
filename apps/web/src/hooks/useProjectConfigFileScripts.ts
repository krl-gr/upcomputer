import {
  PROJECT_CONFIG_FILE_NAME,
  type EnvironmentId,
  type ProjectConfigFileScript,
} from "@upcomputer/contracts";
import { ProjectConfigFileFromJson } from "@upcomputer/shared/projectConfigFile";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const decodeProjectConfigFile = Schema.decodeExit(ProjectConfigFileFromJson);

const NO_SCRIPTS: ReadonlyArray<ProjectConfigFileScript> = [];

/**
 * Scripts declared in the project's checked-in `upcomputer.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useProjectConfigFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): { readonly scripts: ReadonlyArray<ProjectConfigFileScript>; readonly error: string | null } {
  const preferred = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    PROJECT_CONFIG_FILE_NAME,
    cwd !== null,
  );
  const query = preferred;
  const fileName = PROJECT_CONFIG_FILE_NAME;
  const error =
    query.error && !query.notFound
      ? `Cannot read ${fileName}. Check file access and server compatibility.`
      : query.data?.truncated
        ? `${fileName} is too large to import.`
        : null;
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  return useMemo(() => {
    if (error || contents === null) return { scripts: NO_SCRIPTS, error };
    const decoded = decodeProjectConfigFile(contents);
    if (Exit.isFailure(decoded))
      return {
        scripts: NO_SCRIPTS,
        error: `Invalid ${fileName}. Fix it before importing actions.`,
      };
    return { scripts: decoded.value.scripts ?? NO_SCRIPTS, error: null };
  }, [contents, error, fileName]);
}
