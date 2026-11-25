import { useAtomValue } from "@effect/atom-react";
import { toTelemetryProvider, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { BootSplash } from "../components/BootSplash";
import { isElectron } from "../env";
import { isLoopbackHostname } from "../environments/primary/target";
import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { useEnvironments } from "../state/environments";
import { primaryServerConfigAtom, serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import {
  FirstRunAgentStarter,
  useFirstRunAgentSetup,
  useFirstRunAgentStatus,
  useStartFirstRunAgent,
} from "./FirstRunAgent";
import { NoAgentScreen } from "./NoAgentScreen";
import {
  readNoAgentScreenRecord,
  updateNoAgentScreenRecord,
  useNoAgentScreenShownAt,
  type NoAgentScreenPath,
} from "./noAgentScreenRecord";
import {
  noAgentScreenClosesForAgent,
  noAgentScreenFreeAgentReady,
  noAgentScreenPlace,
  noAgentScreenShownDetails,
  resolveNoAgentScreenInstallView,
  type NoAgentScreenView,
} from "./upComputerOnboarding.logic";

/**
 * A new user's first-run setup: the boot splash while their agents answer
 * their first check, then the app, or the no-agent screen when none of their
 * agents is installed.
 */
export function FirstRunAgentSetup({
  environmentId,
  askAgain,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly askAgain: boolean;
  readonly children: ReactNode;
}) {
  const [setup, setSetup] = useFirstRunAgentSetup(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const screenOpen =
    (setup.screen === "offer" || setup.screen === "install") &&
    !noAgentScreenClosesForAgent(providers, setup.screen === "install");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the screen closed for the session once an agent worked
  useEffect(() => {
    if (screenOpen || (setup.screen !== "offer" && setup.screen !== "install")) return;
    setSetup((current) => ({ ...current, screen: "closed" }));
  }, [screenOpen, setSetup, setup.screen]);

  const waiting = setup.start === null || setup.start === "wait";
  return (
    <>
      <FirstRunAgentStarter environmentId={environmentId} askAgain={askAgain} />
      {waiting ? (
        <BootSplash />
      ) : screenOpen ? (
        <NoAgentFirstRunScreen environmentId={environmentId} />
      ) : (
        children
      )}
    </>
  );
}

function NoAgentFirstRunScreen({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const recordClientEvent = useRecordClientEvent();
  const [setup, setSetup] = useFirstRunAgentSetup(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const startInstall = useStartFirstRunAgent(environmentId);
  const { status, installed, retrying, retry } = useFirstRunAgentStatus(
    environmentId,
    setup.start === "install",
  );
  const place = useNoAgentScreenPlace(environmentId);
  const view: NoAgentScreenView =
    setup.screen === "install"
      ? resolveNoAgentScreenInstallView({ status, installed, retrying })
      : { kind: "offer" };
  const record = (action: ScreenAction) =>
    recordClientEvent(environmentId, { event: "onboarding.no_agent_screen", ...action });
  const choose = (path: NoAgentScreenPath) =>
    updateNoAgentScreenRecord((current) => current && { ...current, path });

  const shownRef = useRef(false);
  const reportShown = useEffectEvent(() => {
    setSetup((current) => ({ ...current, screenShownReported: true }));
    updateNoAgentScreenRecord((current) => ({
      shownAt: current?.shownAt ?? Date.now(),
      path: current?.path ?? null,
      agentWorked: false,
    }));
    record({ action: "shown", ...noAgentScreenShownDetails(providers) });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the screen as shown once per window, with what the checks found then
  useEffect(() => {
    if (shownRef.current || setup.screenShownReported) return;
    shownRef.current = true;
    reportShown();
  }, [setup.screenShownReported]);

  const freeAgentReady = noAgentScreenFreeAgentReady(providers);
  const failed = view.kind === "failed";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- remembers a shown failure for the events of later clicks
  useEffect(() => {
    if (failed)
      setSetup((current) => (current.sawFailure ? current : { ...current, sawFailure: true }));
  }, [failed, setSetup]);

  return (
    <NoAgentScreen
      view={view}
      place={place}
      freeAgentReady={freeAgentReady}
      onInstall={() => {
        const attempt = setup.installClicks + 1;
        record({ action: "install_clicked", attempt });
        choose("installed_free_agent");
        // A ready OpenCode needs no install: the chat opens at once.
        if (freeAgentReady) {
          setSetup((current) => ({ ...current, screen: "closed", installClicks: attempt }));
          return;
        }
        const running = setup.start === "install";
        setSetup((current) => ({
          ...current,
          start: "install",
          source: "no_agent_screen",
          screen: "install",
          installClicks: attempt,
        }));
        // Back from "Set up another way": the install went on, and a failed one runs again.
        if (!running) void startInstall("no_agent_screen");
        else if (status?.kind === "failed") retry();
      }}
      onTryAgain={() => {
        if (view.kind === "failed") record({ action: "try_again_clicked", reason: view.reason });
        retry();
      }}
      onSetUpAnotherWay={() => {
        record({
          action: "setup_another_way_clicked",
          during: view.kind === "failed" ? view.reason : "installing",
        });
        // The install goes on, and the install card says when OpenCode is ready.
        setSetup((current) => ({ ...current, screen: "offer" }));
      }}
      onSetUpMyself={() => {
        record({
          action: "setup_myself_clicked",
          afterFailure: setup.sawFailure,
          copiedPrompt: setup.copiedPrompt,
        });
        choose("setup_myself");
        setSetup((current) => ({ ...current, screen: "closed" }));
        void navigate({ to: "/welcome" });
      }}
      onCopyPrompt={() => {
        record({ action: "copy_prompt_clicked", afterFailure: setup.sawFailure });
        choose("copied_prompt");
        setSetup((current) => ({ ...current, copiedPrompt: true }));
      }}
    />
  );
}

type ScreenAction = Omit<
  Extract<
    Parameters<ReturnType<typeof useRecordClientEvent>>[1],
    { readonly event: "onboarding.no_agent_screen" }
  >,
  "event"
>;

function useNoAgentScreenPlace(environmentId: EnvironmentId) {
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const { environments } = useEnvironments();
  const [local] = useState(
    () =>
      isElectron || (typeof window !== "undefined" && isLoopbackHostname(window.location.hostname)),
  );
  return noAgentScreenPlace({
    os: serverConfig?.environment.platform.os ?? null,
    local,
    environmentLabel:
      environments.find((environment) => environment.environmentId === environmentId)?.label ??
      null,
  });
}

/**
 * The first message sent after the no-agent screen, with its thread's agent.
 * Keyed by when the screen showed, so earlier history, such as imported
 * threads, never counts.
 */
const firstMessageAfterAtom = Atom.family((shownAt: number) =>
  Atom.make((get) => {
    let first: { readonly at: number; readonly provider: string } | null = null;
    for (const thread of get(environmentThreadShells.threadShellsAtom)) {
      const at = thread.latestUserMessageAt === null ? NaN : Date.parse(thread.latestUserMessageAt);
      if (!(at >= shownAt) || (first !== null && first.at <= at)) continue;
      const driver = get(serverEnvironment.providersValueAtom(thread.environmentId))?.find(
        (provider) => provider.instanceId === thread.providerInstanceId,
      )?.driver;
      first = { at, provider: driver ?? "other" };
    }
    return first;
  }).pipe(Atom.withLabel("web-no-agent-first-message")),
);

/**
 * Sends `onboarding.first_message_sent` once per app install, on whichever
 * launch the first message after the no-agent screen comes.
 */
export function NoAgentFirstMessageReporter({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const shownAt = useNoAgentScreenShownAt();
  return shownAt === null ? null : (
    <FirstMessageReporter environmentId={environmentId} shownAt={shownAt} />
  );
}

function FirstMessageReporter({
  environmentId,
  shownAt,
}: {
  readonly environmentId: EnvironmentId;
  readonly shownAt: number;
}) {
  const recordClientEvent = useRecordClientEvent();
  const first = useAtomValue(firstMessageAfterAtom(shownAt));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records a telemetry event once, when the first message after the screen appears
  useEffect(() => {
    if (first === null) return;
    const record = readNoAgentScreenRecord();
    if (record === null) return;
    updateNoAgentScreenRecord(() => null);
    recordClientEvent(environmentId, {
      event: "onboarding.first_message_sent",
      ...(record.path === null ? {} : { path: record.path }),
      provider: toTelemetryProvider(first.provider),
      msSinceScreen: Math.max(0, Math.round(first.at - record.shownAt)),
    });
  }, [environmentId, first, recordClientEvent]);
  return null;
}
