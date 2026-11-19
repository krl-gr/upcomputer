import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { completeOnboarding } from "../onboarding/firstRun";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import {
  countReadyOnboardingProviders,
  FIRST_RUN_AGENT_CHECK_WAIT_MS,
  FIRST_RUN_AGENT_INSTANCE_ID,
  FIRST_RUN_AGENT_SLOW_START_MS,
  FIRST_RUN_AGENT_START_TIMEOUT_MS,
  FIRST_SCREEN_IDLE_THRESHOLD_MS,
  firstRunAgentStartupPhase,
  latchFirstRunAgentStart,
  resolveFirstRunAgentStartupFailure,
  resolveFirstRunAgentStatus,
  type FirstRunAgentStart,
  type FirstRunAgentStartup,
  type FirstRunAgentStatus,
} from "./upComputerOnboarding.logic";

const START_FAILED = "Could not start setting up your agent. Check your connection and try again.";
/** A Retry that fails at once still shows that it ran. */
const RETRY_FEEDBACK_MS = 1_000;

/**
 * Set once a new user's window opens, so the composer shows setup at once.
 * `start` is `wait` until the starter decides, then latched for the session,
 * so a remount (for example after /welcome) never decides again. Kept per
 * environment: only the one the starter sets up is waiting on a first agent.
 */
const firstRunAgentAtom = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make<{
    readonly start: "wait" | FirstRunAgentStart | null;
    readonly startError: string | null;
    readonly startup: FirstRunAgentStartup | null;
    /** When this window finished first-run onboarding, if it did. */
    readonly onboardedAt: number | null;
    readonly firstScreenIdleReported: boolean;
  }>({
    start: null,
    startError: null,
    startup: null,
    onboardedAt: null,
    firstScreenIdleReported: false,
  }).pipe(Atom.keepAlive, Atom.withLabel("web-first-run-agent")),
);

/**
 * Install operations and start attempts whose `started` or `failed` event this
 * window already sent, so a remount (for example after /welcome) does not
 * count one twice.
 */
const reportedOperations = new Set<string>();

function useStartFirstRunAgent(environmentId: EnvironmentId) {
  const setSetup = useAtomSet(firstRunAgentAtom(environmentId));
  const recordClientEvent = useRecordClientEvent();
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, {
    reportFailure: false,
    reportDefect: false,
  });
  return async () => {
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
  };
}

/** A user message in any thread means a turn was requested. */
const turnRequestedAtom = Atom.make((get) =>
  get(environmentThreadShells.threadShellsAtom).some(
    (thread) => thread.latestUserMessageAt !== null,
  ),
).pipe(Atom.withLabel("web-first-run-turn-requested"));

/**
 * Renders nothing. In place of the agent table, a new user's window installs
 * OpenCode unless an agent of theirs already works, then finishes onboarding
 * once any agent works. It saves no default model: OpenCode's automatic
 * model is already a zero-retention free one and moves on by itself if that
 * model leaves the free tier, while a saved one would stay unavailable.
 */
export function FirstRunAgentStarter({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const start = useStartFirstRunAgent(environmentId);
  const setup = useAtomValue(firstRunAgentAtom(environmentId));
  const setSetup = useAtomSet(firstRunAgentAtom(environmentId));
  const onboardingCompleted = useClientSettings(
    (settings) => settings.onboardingCompletedAt !== null,
  );
  const recordClientEvent = useRecordClientEvent();
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the clock of a start attempt when the server reports the install done
  useEffect(() => {
    if (succeededOperation === null) return;
    setSetup((current) =>
      current.startup?.operationId === succeededOperation
        ? current
        : {
            ...current,
            startup: {
              operationId: succeededOperation,
              attempt: 0,
              startedAt: Date.now(),
              retriedCheckedAt: null,
              phase: "starting",
            },
          },
    );
  }, [setSetup, succeededOperation]);

  const { startup } = setup;
  // The attempt's identity, not each phase it moves through, restarts its timers.
  const timedAttempt = startup?.phase === "ready" ? null : startup;
  const timedOperationId = timedAttempt?.operationId ?? null;
  const timedAttemptNumber = timedAttempt?.attempt ?? null;
  const timedStartedAt = timedAttempt?.startedAt ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves a start attempt to slow, then timed out, on wall-clock timers
  useEffect(() => {
    if (timedOperationId === null || timedAttemptNumber === null || timedStartedAt === null) return;
    const advance = () =>
      setSetup((current) => {
        const latest = current.startup;
        if (latest?.operationId !== timedOperationId || latest.attempt !== timedAttemptNumber) {
          return current;
        }
        if (latest.phase === "ready") return current;
        const phase = firstRunAgentStartupPhase(Date.now() - timedStartedAt);
        return phase === latest.phase ? current : { ...current, startup: { ...latest, phase } };
      });
    advance();
    const timers = [FIRST_RUN_AGENT_SLOW_START_MS, FIRST_RUN_AGENT_START_TIMEOUT_MS].map((at) =>
      window.setTimeout(advance, Math.max(0, timedStartedAt + at - Date.now())),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [setSetup, timedAttemptNumber, timedOperationId, timedStartedAt]);

  const openCode = providers?.find(
    (provider) => provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID,
  );
  const openCodeReady = getOnboardingProviderState(openCode) === "ready";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- latches the attempt as done once the server reports OpenCode ready
  useEffect(() => {
    if (!openCodeReady || timedOperationId === null) return;
    setSetup((current) =>
      current.startup === null
        ? current
        : { ...current, startup: { ...current.startup, phase: "ready" } },
    );
  }, [openCodeReady, setSetup, timedOperationId]);

  useEffect(() => {
    if (install?.phase !== "failed" || install.operationId === null) return;
    if (reportedOperations.has(`failed:${install.operationId}`)) return;
    reportedOperations.add(`failed:${install.operationId}`);
    recordClientEvent(environmentId, {
      event: "onboarding.first_run_agent",
      outcome: "failed",
      reason: "install",
    });
  }, [environmentId, install?.operationId, install?.phase, recordClientEvent]);

  const startupFailure = resolveFirstRunAgentStartupFailure({
    install: install ?? null,
    provider: openCode,
    startup,
  });
  const startupKey = startup === null ? null : `failed:${startup.operationId}:${startup.attempt}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records a telemetry event once per failed start attempt
  useEffect(() => {
    if (startupFailure === null || startupKey === null || reportedOperations.has(startupKey))
      return;
    reportedOperations.add(startupKey);
    recordClientEvent(environmentId, {
      event: "onboarding.first_run_agent",
      outcome: "failed",
      reason: startupFailure,
    });
  }, [environmentId, recordClientEvent, startupFailure, startupKey]);

  const ready = countReadyOnboardingProviders(providers) > 0;
  const completed = useRef(false);
  useEffect(() => {
    if (!ready || completed.current) return;
    completed.current = true;
    // The Welcome page at /welcome finished it and reported it already.
    if (onboardingCompleted) return;
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
  }, [environmentId, onboardingCompleted, ready, recordClientEvent, setSetup]);

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
 * The environment whose `FirstRunAgentStarter` runs, kept for the session once
 * the gate first asks for it. The gate's evidence changes as soon as the user
 * adds a project or sends a message, while setup, `ready`, `onboarding.completed`
 * and the idle report may still be to come.
 */
export function useFirstRunAgentStarterEnvironment(
  requested: EnvironmentId | null,
): EnvironmentId | null {
  const [kept, setKept] = useState<EnvironmentId | null>(null);
  if (kept === null && requested !== null) setKept(requested);
  return kept ?? requested;
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
  const setup = useAtomValue(firstRunAgentAtom(environmentId));
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
  const openCode = providers?.find(
    (provider) => provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID,
  );
  const setSetup = useAtomSet(firstRunAgentAtom(environmentId));
  const retry = () => {
    recordClientEvent(environmentId, { event: "onboarding.first_run_agent", outcome: "retried" });
    setRetrying(true);
    if (installSucceeded) {
      setSetup((current) =>
        current.startup === null || current.startup.operationId !== install.operationId
          ? current
          : {
              ...current,
              startup: {
                ...current.startup,
                attempt: current.startup.attempt + 1,
                startedAt: Date.now(),
                retriedCheckedAt: openCode?.checkedAt ?? null,
                phase: "starting",
              },
            },
      );
    }
    // Once installed, a failure is OpenCode's own check; installing again would not rerun it.
    const attempt = installSucceeded
      ? refreshProviders({ environmentId, input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID } })
      : start();
    void Promise.all([
      attempt,
      new Promise((resolve) => window.setTimeout(resolve, RETRY_FEEDBACK_MS)),
    ]).finally(() => setRetrying(false));
  };
  const status = active
    ? resolveFirstRunAgentStatus({
        requested: setup.start === "wait" || setup.start === "install",
        startError: setup.startError,
        install,
        provider: openCode,
        startup: setup.startup,
        starterRunning: setup.start !== null,
      })
    : null;
  return { status, retrying, retry };
}
