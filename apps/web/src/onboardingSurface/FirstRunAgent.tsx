import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { useCompleteOnboarding } from "../onboarding/firstRun";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  countReadyOnboardingProviders,
  FIRST_RUN_AGENT_CHECK_WAIT_MS,
  FIRST_RUN_AGENT_INSTANCE_ID,
  latchFirstRunAgentStart,
  resolveFirstRunAgentStatus,
  resolveFirstRunModel,
  type FirstRunAgentStart,
  type FirstRunAgentStatus,
} from "./upComputerOnboarding.logic";

const START_FAILED = "Could not start setting up your agent. Check your connection and try again.";

/**
 * Set once a new user's window opens, so the composer shows setup at once.
 * `start` is `wait` until the starter decides, then latched for the session,
 * so a remount (for example after /welcome) never decides again.
 */
const firstRunAgentAtom = Atom.make<{
  readonly start: "wait" | FirstRunAgentStart | null;
  readonly startError: string | null;
}>({ start: null, startError: null }).pipe(Atom.keepAlive, Atom.withLabel("web-first-run-agent"));

function useStartFirstRunAgent(environmentId: EnvironmentId) {
  const setSetup = useAtomSet(firstRunAgentAtom);
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, {
    reportFailure: false,
    reportDefect: false,
  });
  return useCallback(() => {
    setSetup((setup) => ({ ...setup, startError: null }));
    void startInstall({ environmentId, input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID } }).then(
      (result) => {
        if (result._tag !== "Success")
          setSetup((setup) => ({ ...setup, startError: START_FAILED }));
      },
    );
  }, [environmentId, setSetup, startInstall]);
}

/**
 * Renders nothing. In place of the agent table, a new user's window installs
 * OpenCode unless an agent of theirs already works, then finishes onboarding
 * once any agent works. The first thread gets a zero-retention free model,
 * unless a default model is already set.
 */
export function FirstRunAgentStarter({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const start = useStartFirstRunAgent(environmentId);
  const setup = useAtomValue(firstRunAgentAtom);
  const setSetup = useAtomSet(firstRunAgentAtom);
  const onboardingCompleted = useClientSettings(
    (settings) => settings.onboardingCompletedAt !== null,
  );
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

  const [checkWaitOver, setCheckWaitOver] = useState(false);
  useEffect(() => {
    setSetup((current) => (current.start === null ? { ...current, start: "wait" } : current));
    const timer = window.setTimeout(() => setCheckWaitOver(true), FIRST_RUN_AGENT_CHECK_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [setSetup]);
  const startDecision = latchFirstRunAgentStart({
    latched: setup.start === "wait" || setup.start === null ? null : setup.start,
    completed: onboardingCompleted,
    providers,
    waitOver: checkWaitOver,
  });
  // The ref covers StrictMode's second effect run, before the latch re-renders.
  const decided = useRef(false);
  useEffect(() => {
    if (startDecision === null || setup.start === startDecision || decided.current) return;
    decided.current = true;
    setSetup((current) => ({ ...current, start: startDecision }));
    if (startDecision !== "install") return;
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "started" });
    start();
  }, [environmentId, recordClientEvent, setSetup, setup.start, start, startDecision]);

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
    // Only a user this window installs OpenCode for gets its model as the default.
    if (serverConfig === null || startDecision !== "install") return;
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
  }, [environmentId, model, otherAgentReady, serverConfig, startDecision, updateSettings]);

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
        requested: setup.start === "wait" || setup.start === "install",
        startError: setup.startError,
        install,
        provider: providers?.find(
          (provider) => provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID,
        ),
      })
    : null;
  return { status, retry };
}
