import type { AppView } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { useConnectedEnvironmentIds, usePrimaryEnvironmentId } from "../state/environments";
import {
  appViewForPathname,
  installUiClickTracking,
  useAnalyticsViewOverride,
} from "../uiAnalytics";

// Redirects and sections that name themselves after mounting settle within
// this time; only the view the person lands on is reported.
const VIEW_SETTLE_MS = 500;

/**
 * Reports section views and clicks to the primary environment, whose server
 * applies the install's telemetry opt-out. Nothing is queued while it is
 * disconnected; a new connection hears the current view again.
 */
export function UiAnalyticsCoordinator() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const override = useAnalyticsViewOverride();
  const view = override ?? appViewForPathname(pathname);
  const environmentId = usePrimaryEnvironmentId();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const connected = environmentId !== null && connectedEnvironmentIds.includes(environmentId);
  const recordClientEvent = useRecordClientEvent();
  const lastSentView = useRef<AppView | null>(null);

  useEffect(() => {
    if (!connected) {
      lastSentView.current = null;
      return;
    }
    if (lastSentView.current === view) return;
    const timer = setTimeout(() => {
      lastSentView.current = view;
      recordClientEvent(environmentId ?? undefined, { event: "app.view.opened", view });
    }, VIEW_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [connected, environmentId, recordClientEvent, view]);

  const currentView = useEffectEvent(() => view);
  const sendClick = useEffectEvent((event: Parameters<typeof recordClientEvent>[1]) => {
    if (connected) recordClientEvent(environmentId ?? undefined, event);
  });
  useEffect(
    () =>
      installUiClickTracking(document, {
        view: () => currentView(),
        send: (event) => sendClick(event),
      }),
    [],
  );

  return null;
}
