import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useRef } from "react";

import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { useCompleteOnboarding } from "../onboarding/firstRun";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  countReadyOnboardingProviders,
  FIRST_RUN_AGENT_INSTANCE_ID,
  resolveFirstRunAgentStatus,
  resolveFirstRunModel,
  type FirstRunAgentStatus,
} from "./upComputerOnboarding.logic";

const START_FAILED = "Could not start setting up your agent. Check your connection and try again.";

/** Set once a new user's window starts OpenCode setup, so the composer shows it at once. */
const firstRunAgentAtom = Atom.make<{
  readonly requested: boolean;
  readonly startError: string | null;
}>({ requested: false, startError: null }).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-first-run-agent"),
);

function useStartFirstRunAgent(environmentId: EnvironmentId) {
  const setSetup = useAtomSet(firstRunAgentAtom);
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, {
    reportFailure: false,
    reportDefect: false,
  });
  return useCallback(() => {
    setSetup({ requested: true, startError: null });
    void startInstall({ environmentId, input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID } }).then(
      (result) => {
        if (result._tag !== "Success") setSetup({ requested: true, startError: START_FAILED });
      },
    );
  }, [environmentId, setSetup, startInstall]);
}

/**
 * Renders nothing. In place of the agent table, a new user's window installs
 * OpenCode, then finishes onboarding once any agent works. The first thread
 * gets a zero-retention free model, unless a default model is already set.
 */
export function FirstRunAgentStarter({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const start = useStartFirstRunAgent(environmentId);
  const recordClientEvent = useRecordClientEvent();
  const completeOnboarding = useCompleteOnboarding();
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const install = useEnvironmentQuery(
    serverEnvironment.providerInstallState({
      environmentId,
      input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID },
    }),
  ).data;

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "started" });
    start();
  }, [environmentId, recordClientEvent, start]);

  const failedOperation = useRef<string | null>(null);
  useEffect(() => {
    if (install?.phase !== "failed" || install.operationId === failedOperation.current) return;
    failedOperation.current = install.operationId;
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "failed" });
  }, [environmentId, install?.operationId, install?.phase, recordClientEvent]);

  const openCode = providers?.find(
    (provider) => provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID,
  );
  const model = resolveFirstRunModel(
    openCode?.status === "ready" ? openCode.models.map((entry) => entry.slug) : null,
  );
  // A user whose own agent already works keeps it for new threads.
  const otherAgentReady =
    providers?.some(
      (provider) =>
        provider.instanceId !== FIRST_RUN_AGENT_INSTANCE_ID &&
        provider.enabled &&
        getOnboardingProviderState(provider) === "ready",
    ) ?? false;
  // `undefined` until settings load; `null` when the default model is not ours to set.
  const savedModel = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (serverConfig === null) return;
    if (savedModel.current === undefined && serverConfig.settings.defaultModelSelection !== null) {
      savedModel.current = null;
    }
    if (otherAgentReady) {
      if (savedModel.current) {
        void updateSettings({ environmentId, input: { patch: { defaultModelSelection: null } } });
      }
      savedModel.current = null;
      return;
    }
    if (savedModel.current === null || model === undefined || model === savedModel.current) return;
    savedModel.current = model;
    void updateSettings({
      environmentId,
      input: {
        patch: { defaultModelSelection: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID, model } },
      },
    });
  }, [environmentId, model, otherAgentReady, serverConfig, updateSettings]);

  const ready = countReadyOnboardingProviders(providers) > 0;
  const completed = useRef(false);
  useEffect(() => {
    if (!ready || completed.current) return;
    completed.current = true;
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "ready" });
    void completeOnboarding()
      .then(() =>
        recordClientEvent(environmentId, {
          event: "onboarding.completed",
          flow: "first_run",
          importedProject: false,
          importedThreads: 0,
        }),
      )
      .catch(() => {
        completed.current = false;
      });
  }, [completeOnboarding, environmentId, ready, recordClientEvent]);

  return null;
}

/**
 * What the composer shows instead of "Open provider settings" while a new
 * user's agent is being set up, and the Retry for a failed setup.
 */
export function useFirstRunAgentStatus(
  environmentId: EnvironmentId,
  active: boolean,
): { readonly status: FirstRunAgentStatus | null; readonly retry: () => void } {
  const setup = useAtomValue(firstRunAgentAtom);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const install = useEnvironmentQuery(
    active
      ? serverEnvironment.providerInstallState({
          environmentId,
          input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID },
        })
      : null,
  ).data;
  const start = useStartFirstRunAgent(environmentId);
  const recordClientEvent = useRecordClientEvent();
  const retry = useCallback(() => {
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "retried" });
    start();
  }, [environmentId, recordClientEvent, start]);
  const status = active
    ? resolveFirstRunAgentStatus({
        requested: setup.requested,
        startError: setup.startError,
        install,
        provider: providers?.find(
          (provider) => provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID,
        ),
      })
    : null;
  return { status, retry };
}
