import { useEffect } from "react";

import { appErrorReporter } from "../errorTelemetry";
import { useConnectedEnvironmentIds, usePrimaryEnvironmentId } from "../state/environments";
import { useRecordClientEvent } from "./useRecordClientEvent";

/**
 * Sends reported errors to the primary environment while it is connected. Both
 * the app and the root error view mount this, since the error view replaces
 * the app.
 */
export function useAppErrorTelemetrySender() {
  const environmentId = usePrimaryEnvironmentId();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const connected = environmentId !== null && connectedEnvironmentIds.includes(environmentId);
  const recordClientEvent = useRecordClientEvent();
  useEffect(() => {
    if (!connected || environmentId === null) return;
    appErrorReporter.setSender((event) => recordClientEvent(environmentId, event));
    return () => appErrorReporter.setSender(null);
  }, [connected, environmentId, recordClientEvent]);
}
