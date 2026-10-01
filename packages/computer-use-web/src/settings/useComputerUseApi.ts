import { useMemo } from "react";

import { readEnvironmentExtensionApi } from "../../../../apps/web/src/extensionApi.ts";
import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";
import { COMPUTER_USE_WEB_ENVIRONMENT_API } from "../environmentApi.ts";

/** The browser and computer-use settings API of the primary environment. */
export function useComputerUseApi() {
  const environmentId = usePrimaryEnvironmentId();
  return useMemo(
    () =>
      environmentId === null
        ? undefined
        : readEnvironmentExtensionApi(environmentId, COMPUTER_USE_WEB_ENVIRONMENT_API),
    [environmentId],
  );
}

export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
