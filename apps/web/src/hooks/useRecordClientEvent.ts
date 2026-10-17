import type { ClientTelemetryEvent, EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Records a UI event through an environment's server, so it carries that
 * install's telemetry identity and opt-out. Best effort: never surfaces errors.
 */
export function useRecordClientEvent() {
  const record = useAtomCommand(serverEnvironment.recordClientEvent, {
    reportFailure: false,
    reportDefect: false,
  });
  return useCallback(
    (environmentId: EnvironmentId | undefined, input: ClientTelemetryEvent) => {
      if (environmentId !== undefined) void record({ environmentId, input });
    },
    [record],
  );
}
