import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { msg, useMessages } from "gt-react";
import { useEffect, useRef, useState } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { completeOnboarding } from "../onboarding/firstRun";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { shouldCreateAgentSetupOffer, updateAgentSetupOfferRecord } from "./agentSetupOffer.logic";
import { updateNoAgentScreenRecord } from "./noAgentScreenRecord";
import {
  countReadyOnboardingProviders,
  FIRST_RUN_SETUP_FAILED,
  FIRST_RUN_START_TIMED_OUT,
  FIRST_RUN_AGENT_CHECK_WAIT_MS,
  FIRST_RUN_AGENT_INSTANCE_ID,
  FIRST_RUN_AGENT_SLOW_START_MS,
  FIRST_RUN_AGENT_START_TIMEOUT_MS,
  FIRST_SCREEN_IDLE_THRESHOLD_MS,
  firstRunAgentRetrying,
  firstRunAgentStartupPhase,
  latchFirstRunAgentStart,
  resolveFirstRunAgentAutoRetry,
  resolveFirstRunAgentStartupFailure,
  resolveFirstRunAgentStatus,
  type FirstRunAgentAutoRetry,
  type FirstRunAgentStart,
  type FirstRunAgentStartup,
  type FirstRunAgentStatus,
} from "./upComputerOnboarding.logic";

const START_FAILED = msg(
  "Could not start setting up your agent. Check your connection and try again.",
);
/** The status's failure text that is ours; the rest comes from the server or OpenCode. */
const OWN_FAILURE_MESSAGES: ReadonlySet<string> = new Set([
  START_FAILED,
  FIRST_RUN_SETUP_FAILED,
  FIRST_RUN_START_TIMED_OUT,
]);
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
    /** Set once the automatic retry ran, with the failed install it replaced, if any. */
    readonly autoRetry: { readonly failedInstallId: string | null } | null;
    /** When this window finished first-run onboarding, if it did. */
    readonly onboardedAt: number | null;
    readonly firstScreenIdleReported: boolean;
    /** Set when the user picked the install on the no-agent screen, for its events. */
    readonly source: FirstRunAgentSource | null;
    /** The no-agent screen: its cards, the install it shows, or closed for this session. */
    readonly screen: "offer" | "install" | "closed" | null;
    readonly screenShownReported: boolean;
    readonly installClicks: number;
    readonly sawFailure: boolean;
    readonly copiedPrompt: boolean;
  }>({
    start: null,
    startError: null,
    startup: null,
    autoRetry: null,
    onboardedAt: null,
    firstScreenIdleReported: false,
    source: null,
    screen: null,
    screenShownReported: false,
    installClicks: 0,
    sawFailure: false,
    copiedPrompt: false,
  }).pipe(Atom.keepAlive, Atom.withLabel("web-first-run-agent")),
);

type FirstRunAgentSource = "no_agent_screen";

const sourceProps = (source: FirstRunAgentSource | null) =>
  source === null ? {} : ({ source } as const);

/** The first-run setup's state, for the no-agent screen that drives it. */
export function useFirstRunAgentSetup(environmentId: EnvironmentId) {
  return [
    useAtomValue(firstRunAgentAtom(environmentId)),
    useAtomSet(firstRunAgentAtom(environmentId)),
  ] as const;
}

/**
 * Install operations and start attempts whose `started` or `failed` event this
 * window already sent, so a remount (for example after /welcome) does not
 * count one twice.
 */
const reportedOperations = new Set<string>();

export function useStartFirstRunAgent(environmentId: EnvironmentId) {
  const setSetup = useAtomSet(firstRunAgentAtom(environmentId));
  const recordClientEvent = useRecordClientEvent();
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, {
    reportFailure: false,
    reportDefect: false,
  });
  return async (source: FirstRunAgentSource | null) => {
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
    recordClientEvent(environmentId, {
      event: "onboarding.first_run_agent",
      outcome: "started",
      ...sourceProps(source),
    });
  };
}

/** Runs a start attempt again: OpenCode's own check once it is installed, else the install. */
function useRunFirstRunAgentAttempt(environmentId: EnvironmentId) {
  const start = useStartFirstRunAgent(environmentId);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });
  return (installed: boolean, source: FirstRunAgentSource | null): Promise<unknown> =>
    installed
      ? refreshProviders({ environmentId, input: { instanceId: FIRST_RUN_AGENT_INSTANCE_ID } })
      : start(source);
}

/** The next attempt after `startup`, which a failed result from before it says nothing about. */
function retriedStartup(
  startup: FirstRunAgentStartup,
  failedCheckedAt: string | null,
  automatic: boolean,
): FirstRunAgentStartup {
  return {
    ...startup,
    attempt: startup.attempt + 1,
    startedAt: Date.now(),
    retriedCheckedAt: failedCheckedAt,
    phase: "starting",
    automatic,
  };
}

function firstRunAgentAutoRetry(setup: {
  readonly start: "wait" | FirstRunAgentStart | null;
  readonly autoRetry: { readonly failedInstallId: string | null } | null;
}): FirstRunAgentAutoRetry {
  if (setup.start !== "install") return { kind: "off" };
  return setup.autoRetry === null
    ? { kind: "available" }
    : { kind: "used", failedInstallId: setup.autoRetry.failedInstallId };
}

/** A user message in any thread means a turn was requested. */
const turnRequestedAtom = Atom.make((get) =>
  get(environmentThreadShells.threadShellsAtom).some(
    (thread) => thread.latestUserMessageAt !== null,
  ),
).pipe(Atom.withLabel("web-first-run-turn-requested"));

/**
 * Installs OpenCode unless the user's own agent works, or with none installed opens the
 * no-agent screen, then finishes onboarding once any agent works. No default model is
 * saved: OpenCode's own pick stays a free zero-retention one, while a saved one may leave the free tier.
 */
export function FirstRunAgentStarter({
  environmentId,
  askAgain,
}: {
  readonly environmentId: EnvironmentId;
  /** A user who left the no-agent screen on an earlier launch without a working agent. */
  readonly askAgain: boolean;
}) {
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
    askAgain,
    providers,
    waitOver: checkWaitOver,
  });
  // The ref covers StrictMode's second effect run, before the latch re-renders.
  const decided = useRef(false);
  useEffect(() => {
    if (startDecision === null || setup.start === startDecision || decided.current) return;
    decided.current = true;
    setSetup((current) => ({
      ...current,
      start: startDecision,
      screen: startDecision === "ask" ? "offer" : current.screen,
    }));
    if (startDecision === "install") void start(null);
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
              automatic: false,
              sawEnabled: false,
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
  const openCodeOn = openCode?.enabled === true;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records what the server reports of OpenCode during the attempt: on, then ready
  useEffect(() => {
    if ((!openCodeReady && !openCodeOn) || timedOperationId === null) return;
    setSetup((current) => {
      const latest = current.startup;
      if (latest === null || (latest.sawEnabled && !openCodeReady)) return current;
      return {
        ...current,
        startup: { ...latest, sawEnabled: true, phase: openCodeReady ? "ready" : latest.phase },
      };
    });
  }, [openCodeOn, openCodeReady, setSetup, timedOperationId]);

  useEffect(() => {
    if (install?.phase !== "failed" || install.operationId === null) return;
    if (reportedOperations.has(`failed:${install.operationId}`)) return;
    reportedOperations.add(`failed:${install.operationId}`);
    recordClientEvent(environmentId, {
      event: "onboarding.first_run_agent",
      outcome: "failed",
      reason: "install",
      ...sourceProps(setup.source),
    });
  }, [environmentId, install?.operationId, install?.phase, recordClientEvent, setup.source]);

  const runAttempt = useRunFirstRunAgentAttempt(environmentId);
  const autoRetryRun = resolveFirstRunAgentAutoRetry({
    requested: setup.start === "wait" || setup.start === "install",
    startError: setup.startError,
    install: install ?? null,
    provider: openCode,
    startup,
    starterRunning: setup.start !== null,
    autoRetry: firstRunAgentAutoRetry(setup),
  });
  const failedInstallId = install?.operationId ?? null;
  const failedCheckedAt = openCode?.checkedAt ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the first run's one automatic retry when an attempt fails
  useEffect(() => {
    if (autoRetryRun === null) return;
    let claimed = false;
    setSetup((current) => {
      if (current.autoRetry !== null) return current;
      claimed = true;
      return {
        ...current,
        autoRetry: { failedInstallId: autoRetryRun === "install" ? failedInstallId : null },
        startup:
          autoRetryRun === "start" && current.startup !== null
            ? retriedStartup(current.startup, failedCheckedAt, true)
            : current.startup,
      };
    });
    if (!claimed) return;
    recordClientEvent(environmentId, {
      event: "onboarding.first_run_agent",
      outcome: "retried",
      automatic: true,
      ...sourceProps(setup.source),
    });
    void runAttempt(autoRetryRun === "start", setup.source);
  }, [
    autoRetryRun,
    environmentId,
    failedCheckedAt,
    failedInstallId,
    recordClientEvent,
    runAttempt,
    setSetup,
    setup.source,
  ]);

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
      ...sourceProps(setup.source),
    });
  }, [environmentId, recordClientEvent, setup.source, startupFailure, startupKey]);

  const ready = countReadyOnboardingProviders(providers) > 0;
  const completed = useRef(false);
  useEffect(() => {
    if (!ready || completed.current) return;
    completed.current = true;
    // A later launch without a working agent no longer shows the no-agent screen.
    updateNoAgentScreenRecord((record) => record && { ...record, agentWorked: true });
    updateAgentSetupOfferRecord((existing) =>
      shouldCreateAgentSetupOffer({ existing, source: setup.source, providers })
        ? { createdAt: Date.now(), threadId: null, state: "open" }
        : existing,
    );
    // An install from the screen on a later launch still reports its `ready`.
    if (!onboardingCompleted || setup.source !== null) {
      recordClientEvent(environmentId, {
        event: "onboarding.first_run_agent",
        outcome: "ready",
        ...sourceProps(setup.source),
      });
    }
    // The Welcome page at /welcome finished onboarding and reported it already.
    if (onboardingCompleted) return;
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
  }, [
    environmentId,
    onboardingCompleted,
    providers,
    ready,
    recordClientEvent,
    setSetup,
    setup.source,
  ]);

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
  /** The install finished, so what is left is OpenCode's start. */
  readonly installed: boolean;
  readonly retrying: boolean;
  readonly retry: () => void;
} {
  const m = useMessages();
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
  const runAttempt = useRunFirstRunAgentAttempt(environmentId);
  const recordClientEvent = useRecordClientEvent();
  const [requestRunning, setRequestRunning] = useState(false);
  const [retriedInstallId, setRetriedInstallId] = useState<string | null | undefined>(undefined);
  const installSucceeded = install?.phase === "succeeded";
  const openCode = providers?.find(
    (provider) => provider.instanceId === FIRST_RUN_AGENT_INSTANCE_ID,
  );
  const setSetup = useAtomSet(firstRunAgentAtom(environmentId));
  const retry = () => {
    recordClientEvent(environmentId, {
      event: "onboarding.first_run_agent",
      outcome: "retried",
      ...sourceProps(setup.source),
    });
    setRequestRunning(true);
    setRetriedInstallId(installSucceeded ? undefined : (install?.operationId ?? null));
    if (installSucceeded) {
      setSetup((current) =>
        current.startup === null || current.startup.operationId !== install.operationId
          ? current
          : {
              ...current,
              startup: retriedStartup(current.startup, openCode?.checkedAt ?? null, false),
            },
      );
    }
    // Once installed, a failure is OpenCode's own check; installing again would not rerun it.
    const attempt = runAttempt(installSucceeded, setup.source);
    const after = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    // The attempt's own timeout offers Retry again, even if its request never returns.
    const timedOut = after(FIRST_RUN_AGENT_START_TIMEOUT_MS).then(() => "timedOut" as const);
    void Promise.all([Promise.race([attempt, timedOut]), after(RETRY_FEEDBACK_MS)])
      .then(([result]) => {
        if (result === "timedOut") setRetriedInstallId(undefined);
      })
      .finally(() => setRequestRunning(false));
  };
  const resolved = active
    ? resolveFirstRunAgentStatus({
        requested: setup.start === "wait" || setup.start === "install",
        startError: setup.startError,
        install,
        provider: openCode,
        startup: setup.startup,
        starterRunning: setup.start !== null,
        autoRetry: firstRunAgentAutoRetry(setup),
      })
    : null;
  const status =
    resolved?.kind === "failed" && OWN_FAILURE_MESSAGES.has(resolved.message)
      ? { ...resolved, message: m(resolved.message) }
      : resolved;
  const retrying = firstRunAgentRetrying({
    requestRunning,
    retriedInstallId,
    startError: setup.startError,
    install,
  });
  return { status, installed: installSucceeded, retrying, retry };
}
