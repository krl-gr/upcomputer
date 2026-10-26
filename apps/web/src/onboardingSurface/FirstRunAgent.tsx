import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { useCompleteOnboarding } from "../onboarding/firstRun";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  countReadyOnboardingProviders,
  FIRST_RUN_AGENT_ACTIVATION_WAIT_MS,
  FIRST_RUN_AGENT_CHECK_WAIT_MS,
  FIRST_RUN_AGENT_INSTANCE_ID,
  FIRST_SCREEN_IDLE_THRESHOLD_MS,
  isFirstRunAgentActivating,
  latchFirstRunAgentStart,
  resolveFirstRunAgentStatus,
  type FirstRunAgentActivation,
  type FirstRunAgentStart,
  type FirstRunAgentStatus,
} from "./upComputerOnboarding.logic";

const START_FAILED = "Could not start setting up your agent. Check your connection and try again.";
/** A Retry that fails at once still shows that it ran. */
const RETRY_FEEDBACK_MS = 1_000;

/**
 * Set once a new user's window opens, so the composer shows setup at once.
 * `start` is `wait` until the starter decides, then latched for the session,
 * so a remount (for example after /welcome) never decides again.
 */
const firstRunAgentAtom = Atom.make<{
  readonly start: "wait" | FirstRunAgentStart | null;
  readonly startError: string | null;
  readonly activation: FirstRunAgentActivation | null;
  /** When this window finished first-run onboarding, if it did. */
  readonly onboardedAt: number | null;
  readonly firstScreenIdleReported: boolean;
}>({
  start: null,
  startError: null,
  activation: null,
  onboardedAt: null,
  firstScreenIdleReported: false,
}).pipe(Atom.keepAlive, Atom.withLabel("web-first-run-agent"));

/**
 * Install operations whose `started` or `failed` event this window already
 * sent, so a remount (for example after /welcome) does not count one twice.
 */
const reportedOperations = new Set<string>();

function useStartFirstRunAgent(environmentId: EnvironmentId) {
  const setSetup = useAtomSet(firstRunAgentAtom);
  const recordClientEvent = useRecordClientEvent();
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, {
    reportFailure: false,
    reportDefect: false,
  });
  return useCallback(async () => {
    setSetup((setup) => ({ ...setup, startError: null }));
    const result = await startInstall({
      environmentId,
      input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID },
    });
    if (result._tag !== "Success") {
      setSetup((setup) => ({ ...setup, startError: START_FAILED }));
      return;
    }
    // A user's own OpenCode succeeds at once; `started` counts real downloads.
    const { operationId, phase } = result.value;
    if (phase !== "downloading" || operationId === null) return;
    if (reportedOperations.has(`started:${operationId}`)) return;
    reportedOperations.add(`started:${operationId}`);
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "started" });
  }, [environmentId, recordClientEvent, setSetup, startInstall]);
}

/** A user message in any thread means a turn was requested. */
const turnRequestedAtom = Atom.make((get) =>
  get(environmentThreadShells.threadShellsAtom).some(
    (thread) => thread.latestUserMessageAt !== null,
  ),
).pipe(Atom.withLabel("web-first-run-turn-requested"));

/** When this window first saw each install succeed, keyed by its operation, across remounts. */
let activationWait: { readonly operationId: string; readonly until: number } | null = null;

/**
 * Renders nothing. In place of the agent table, a new user's window installs
 * OpenCode unless an agent of theirs already works, then finishes onboarding
 * once any agent works. It saves no default model: OpenCode's automatic
 * model is already a zero-retention free one and moves on by itself if that
 * model leaves the free tier, while a saved one would stay unavailable.
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
    if (startDecision === "install") void start();
  }, [setSetup, setup.start, start, startDecision]);

  const succeededOperation = install?.phase === "succeeded" ? install.operationId : null;
  useEffect(() => {
    if (succeededOperation === null) return;
    if (activationWait?.operationId !== succeededOperation) {
      activationWait = {
        operationId: succeededOperation,
        until: Date.now() + FIRST_RUN_AGENT_ACTIVATION_WAIT_MS,
      };
    }
    const settle = (active: boolean) =>
      setSetup((current) => ({
        ...current,
        activation: { operationId: succeededOperation, active },
      }));
    const remaining = activationWait.until - Date.now();
    if (remaining <= 0) {
      settle(false);
      return;
    }
    settle(true);
    const timer = window.setTimeout(() => settle(false), remaining);
    return () => {
      window.clearTimeout(timer);
      settle(false);
    };
  }, [setSetup, succeededOperation]);

  useEffect(() => {
    if (install?.phase !== "failed" || install.operationId === null) return;
    if (reportedOperations.has(`failed:${install.operationId}`)) return;
    reportedOperations.add(`failed:${install.operationId}`);
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "failed" });
  }, [environmentId, install?.operationId, install?.phase, recordClientEvent]);

  const ready = countReadyOnboardingProviders(providers) > 0;
  const completed = useRef(false);
  useEffect(() => {
    if (!ready || completed.current) return;
    completed.current = true;
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "ready" });
    void completeOnboarding()
      .then(() => {
        recordClientEvent(environmentId, {
          event: "onboarding.completed",
          flow: "first_run",
          importedProject: false,
          importedThreads: 0,
        });
        setSetup((current) =>
          current.onboardedAt === null ? { ...current, onboardedAt: Date.now() } : current,
        );
      })
      .catch(() => {
        completed.current = false;
      });
  }, [completeOnboarding, environmentId, ready, recordClientEvent, setSetup]);

  // Only a window that onboarded a new user starts this, so installs onboarded
  // before never report it, and an app closed sooner reports nothing.
  const turnRequested = useAtomValue(turnRequestedAtom);
  useEffect(() => {
    if (setup.onboardedAt === null || turnRequested || setup.firstScreenIdleReported) return;
    const timer = window.setTimeout(
      () => {
        setSetup((current) => ({ ...current, firstScreenIdleReported: true }));
        recordClientEvent(environmentId, {
          event: "onboarding.first_screen_idle",
          thresholdMs: FIRST_SCREEN_IDLE_THRESHOLD_MS,
        });
      },
      Math.max(0, setup.onboardedAt + FIRST_SCREEN_IDLE_THRESHOLD_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [
    environmentId,
    recordClientEvent,
    setSetup,
    setup.firstScreenIdleReported,
    setup.onboardedAt,
    turnRequested,
  ]);

  return null;
}

/**
 * What the composer shows instead of "Open provider settings" while a new
 * user's agent is being set up, and the Retry for a failed setup.
 */
export function useFirstRunAgentStatus(
  environmentId: EnvironmentId,
  active: boolean,
): {
  readonly status: FirstRunAgentStatus | null;
  readonly retrying: boolean;
  readonly retry: () => void;
} {
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
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });
  const recordClientEvent = useRecordClientEvent();
  const [retrying, setRetrying] = useState(false);
  const installSucceeded = install?.phase === "succeeded";
  const retry = useCallback(() => {
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "retried" });
    setRetrying(true);
    // Once installed, a failure is OpenCode's own check; installing again would not rerun it.
    const attempt = installSucceeded
      ? refreshProviders({ environmentId, input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID } })
      : start();
    void Promise.all([
      attempt,
      new Promise((resolve) => window.setTimeout(resolve, RETRY_FEEDBACK_MS)),
    ]).finally(() => setRetrying(false));
  }, [environmentId, installSucceeded, recordClientEvent, refreshProviders, start]);
  const status = active
    ? resolveFirstRunAgentStatus({
        requested: setup.start === "wait" || setup.start === "install",
        startError: setup.startError,
        install,
        provider: providers?.find(
          (provider) => provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID,
        ),
        activating: isFirstRunAgentActivating({
          succeededOperationId: install?.phase === "succeeded" ? install.operationId : null,
          starterRunning: setup.start !== null,
          activation: setup.activation,
        }),
      })
    : null;
  return { status, retrying, retry };
}
