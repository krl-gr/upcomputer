import { useMemo } from "react";

import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";
import { createComputerUseWebRpcClient } from "../rpc/computerUseRpcClient.ts";

/** The browser and computer-use settings API of the primary environment. */
export function useComputerUseApi() {
  const environmentId = usePrimaryEnvironmentId();
  return useMemo(
    () => (environmentId === null ? undefined : createComputerUseWebRpcClient(environmentId)),
    [environmentId],
  );
}

export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
