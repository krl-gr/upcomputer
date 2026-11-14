import {
  toTelemetryProvider,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useRecordClientEvent } from "../hooks/useRecordClientEvent";

/*
 * Up.computer's onboarding events from upstream's Welcome page, sent with
 * `flow: "welcome"`. The page is one step, `agents`, with project import on
 * the same page: see docs/internals/product-analytics.md.
 */

const FLOW = "welcome";

type TerminalAction = "install" | "sign_in";

/** The action each open install or sign-in terminal ran, so its close can report it. */
const openTerminals = new Map<ProviderInstanceId, TerminalAction>();

/** Records the page view once per mount. */
export function useWelcomePageViewed(environmentId: EnvironmentId) {
  const recordClientEvent = useRecordClientEvent();
  const viewed = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records a telemetry event once the page has rendered
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    recordClientEvent(environmentId, {
      event: "onboarding.step.viewed",
      step: "agents",
      flow: FLOW,
    });
  }, [environmentId, recordClientEvent]);
}

export function useWelcomeTelemetry(environmentId: EnvironmentId) {
  const recordClientEvent = useRecordClientEvent();
  return {
    terminalOpened: (provider: Pick<ServerProvider, "driver" | "installed" | "instanceId">) => {
      const action: TerminalAction = provider.installed ? "sign_in" : "install";
      openTerminals.set(provider.instanceId, action);
      recordClientEvent(environmentId, {
        event: "onboarding.agent.action",
        provider: toTelemetryProvider(provider.driver),
        action,
      });
    },
    /** `refreshed` is the provider list the close re-read, so the event sees the outcome. */
    terminalClosed: (
      instanceId: ProviderInstanceId,
      refreshed: ReadonlyArray<ServerProvider> | undefined,
    ) => {
      const action = openTerminals.get(instanceId);
      openTerminals.delete(instanceId);
      const provider = refreshed?.find((entry) => entry.instanceId === instanceId);
      if (action === undefined || provider === undefined) return;
      recordClientEvent(environmentId, {
        event: "onboarding.agent.terminal_closed",
        provider: toTelemetryProvider(provider.driver),
        action,
        installed: provider.installed,
        authStatus: provider.auth.status,
      });
    },
    codexModeChosen: (setupMode: "managed" | "existing") =>
      recordClientEvent(environmentId, {
        event: "onboarding.agent.action",
        provider: "codex",
        action: setupMode === "managed" ? "continue_with_chatgpt" : "use_existing_cli",
      }),
    /** Start, or Start without an agent: who leaves the page with no agent ready. */
    started: (readyProviders: number) =>
      recordClientEvent(environmentId, {
        event: "onboarding.step.completed",
        step: "agents",
        flow: FLOW,
        outcome: readyProviders > 0 ? "continued" : "skipped",
        readyProviders,
      }),
    completed: (importedProject: boolean, importedThreads: number) =>
      recordClientEvent(environmentId, {
        event: "onboarding.completed",
        flow: FLOW,
        importedProject,
        importedThreads,
      }),
  };
}
