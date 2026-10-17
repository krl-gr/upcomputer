import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthTerminalOperateScope,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type EnvironmentId,
  type ScopedProjectRef,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { ArrowLeftIcon, CheckIcon, LoaderIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CommandBlock } from "../components/CommandBlock";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import {
  AgentInstallTerminal,
  ImportStep,
  type AgentTerminalSession,
} from "../components/onboarding/WelcomeWizard";
import { ChatGptWelcomeCoordinator } from "../components/settings/ChatGptWelcomeCoordinator";
import { CodexSetupSection } from "../components/settings/CodexSetupSection";
import { readCodexSetupMode } from "../components/settings/CodexSetupSection.logic";
import { buildProviderInstanceUpdatePatch } from "../components/settings/SettingsPanels.logic";
import { Skeleton } from "../components/ui/skeleton";
import { toastManager } from "../components/ui/toast";
import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { PRIVACY_POLICY_URL } from "../legalLinks";
import { useCompleteOnboarding } from "../onboarding/firstRun";
import {
  getOnboardingProviderState,
  resolveOnboardingProviderInstallCommand,
  resolveOnboardingProviderLoginCommand,
  selectOnboardingProvidersByDriver,
} from "../onboarding/providerReadiness.logic";
import { useProjectScans } from "../onboarding/useProjectScans";
import { isProductFeatureShown } from "../product/productFlags";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import {
  countReadyOnboardingProviders,
  describeOnboardingAgent,
  isCodexExistingCliChosen,
  resolveAgentInstallCell,
  resolveAgentReadyCell,
  resolveProjectImportOffer,
  UPCOMPUTER_ONBOARDING_DRIVERS,
  type UpComputerOnboardingDriver,
} from "./upComputerOnboarding.logic";

const FLOW = "upcomputer";
const ROW_GRID = "grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_6rem_6rem]";
// V1's pill buttons: light on the dark card, dark on the light one.
const PILL_CLASS =
  "flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-foreground/85 text-sm font-medium text-background shadow-sm transition-transform duration-150 hover:scale-105 disabled:pointer-events-none disabled:opacity-40";
const ROW_ACTION_CLASS = `${PILL_CLASS} h-8 w-[5.5rem] px-3 sm:w-24`;
const ICON_BUTTON_CLASS = `${PILL_CLASS} size-8`;
const PRIMARY_CLASS = `${PILL_CLASS} h-9 px-5`;

const AGENT_NAMES: Record<UpComputerOnboardingDriver, string> = {
  codex: "Codex",
  claudeAgent: "Claude Code",
};

type Screen =
  | { readonly kind: "agents" }
  | { readonly kind: "agent"; readonly driver: UpComputerOnboardingDriver }
  | { readonly kind: "import" };

/**
 * V1's first run over upstream's provider logic: a table of the two agents a
 * new user can make work in a minute, each opening its own screen, then
 * project import only when there is something to import.
 */
export function UpComputerOnboarding({
  environmentId,
  resumeCodexSetup,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  /** Back from a browser ChatGPT sign-in: reopen Codex's screen. */
  readonly resumeCodexSetup: boolean;
  readonly onDone: (projectRef?: ScopedProjectRef) => void | Promise<void>;
}) {
  const [screen, setScreen] = useState<Screen>(
    resumeCodexSetup ? { kind: "agent", driver: "codex" } : { kind: "agents" },
  );
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "Agent setup settings");
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const recordClientEvent = useRecordClientEvent();
  const completeOnboarding = useCompleteOnboarding();
  const setupIds = useMemo(() => [environmentId], [environmentId]);
  // Scanned from the start, so the step after a working agent is known at once.
  const scans = useProjectScans(setupIds);
  const [isImporting, setIsImporting] = useState(false);
  const [codexAutoStart, setCodexAutoStart] = useState(false);
  const [terminalSession, setTerminalSession] = useState<AgentTerminalSession | null>(null);
  const [notOnPath, setNotOnPath] = useState<ReadonlySet<UpComputerOnboardingDriver>>(new Set());

  useEffect(() => {
    void refreshProviders({ environmentId, input: {} });
  }, [environmentId, refreshProviders]);

  const stepName = screen.kind === "import" ? "import" : "agents";
  const viewedSteps = useRef(new Set<string>());
  useEffect(() => {
    if (viewedSteps.current.has(stepName)) return;
    viewedSteps.current.add(stepName);
    recordClientEvent(environmentId, {
      event: "onboarding.step.viewed",
      step: stepName,
      flow: FLOW,
    });
  }, [environmentId, recordClientEvent, stepName]);

  const byDriver = useMemo(() => selectOnboardingProvidersByDriver(providers), [providers]);
  const codexProvider = byDriver.get("codex");
  const codexInstanceId =
    codexProvider?.instanceId ?? defaultInstanceIdForDriver(ProviderDriverKind.make("codex"));
  const codexInstance = serverConfig?.settings.providerInstances[codexInstanceId] ?? {
    driver: ProviderDriverKind.make("codex"),
    config: {},
  };
  const codexExistingCli = isCodexExistingCliChosen(codexInstance.config);
  const readyProviders = countReadyOnboardingProviders(providers);

  const changeCodexMode = (setupMode: "managed" | "existing") => {
    if (serverConfig === null) return;
    recordClientEvent(environmentId, {
      event: "onboarding.agent.action",
      provider: ProviderDriverKind.make("codex"),
      action: setupMode === "managed" ? "continue_with_chatgpt" : "use_existing_cli",
    });
    void updateSettings({
      environmentId,
      input: {
        patch: buildProviderInstanceUpdatePatch({
          settings: serverConfig.settings,
          instanceId: codexInstanceId,
          instance: {
            ...codexInstance,
            enabled: true,
            config: {
              ...(codexInstance.config !== null && typeof codexInstance.config === "object"
                ? codexInstance.config
                : {}),
              enabled: true,
              setupMode,
            },
          },
        }),
      },
    });
  };

  const enableAgent = (provider: ServerProvider) => {
    if (serverConfig === null) return;
    const instance = serverConfig.settings.providerInstances[provider.instanceId] ?? {
      driver: provider.driver,
    };
    void updateSettings({
      environmentId,
      input: {
        patch: buildProviderInstanceUpdatePatch({
          settings: serverConfig.settings,
          instanceId: provider.instanceId,
          instance: { ...instance, enabled: true },
        }),
      },
    });
  };

  const openTerminal = (driver: UpComputerOnboardingDriver, provider: ServerProvider) => {
    if (serverConfig === null || !readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
      return;
    }
    const action = provider.installed ? "sign_in" : "install";
    recordClientEvent(environmentId, {
      event: "onboarding.agent.action",
      provider: provider.driver,
      action,
    });
    setTerminalSession({
      environmentId,
      driver,
      action,
      providerInstanceId: provider.instanceId,
      cwd: serverConfig.cwd,
      command: agentTerminalCommand(driver, provider, serverConfig),
      keybindings: serverConfig.keybindings,
    });
  };

  const closeTerminal = (session: AgentTerminalSession) => {
    setTerminalSession(null);
    void refreshProviders({ environmentId, input: {} }).then((refreshed) => {
      const provider =
        refreshed._tag === "Success"
          ? refreshed.value.providers.find(
              (entry) => entry.instanceId === session.providerInstanceId,
            )
          : undefined;
      if (provider === undefined) return;
      // The installers put the CLI in ~/.local/bin, which a running server may not search yet.
      setNotOnPath((current) => {
        const next = new Set(current);
        if (session.action === "install" && !provider.installed) next.add(session.driver);
        else next.delete(session.driver);
        return next;
      });
      recordClientEvent(environmentId, {
        event: "onboarding.agent.terminal_closed",
        provider: provider.driver,
        action: session.action,
        installed: provider.installed,
        authStatus: provider.auth.status,
      });
    });
  };

  const finishingRef = useRef<Promise<boolean> | null>(null);
  const finish = useCallback(
    (projectRef?: ScopedProjectRef, importWarning?: string, importedThreadCount = 0) => {
      if (finishingRef.current !== null) return finishingRef.current;
      const completion = completeOnboarding()
        .then(async () => {
          recordClientEvent(environmentId, {
            event: "onboarding.completed",
            flow: FLOW,
            importedProject: projectRef !== undefined,
            importedThreads: importedThreadCount,
          });
          await onDone(projectRef);
          if (importWarning) {
            toastManager.add({
              type: "warning",
              title: "Some history was not imported",
              description: importWarning,
              timeout: 0,
            });
          } else if (importedThreadCount > 0) {
            toastManager.add({
              type: "success",
              title: `Imported ${importedThreadCount} ${importedThreadCount === 1 ? "conversation" : "conversations"}`,
            });
          }
          return true;
        })
        .catch(() => {
          toastManager.add({
            type: "error",
            title: "Could not finish setup",
            description: "Your settings could not be saved. Try again.",
          });
          return false;
        })
        .finally(() => {
          if (finishingRef.current === completion) finishingRef.current = null;
        });
      finishingRef.current = completion;
      return completion;
    },
    [completeOnboarding, environmentId, onDone, recordClientEvent],
  );

  const finishImport = useCallback(
    (projectRef?: ScopedProjectRef, importWarning?: string, importedThreadCount = 0) => {
      recordClientEvent(environmentId, {
        event: "onboarding.step.completed",
        step: "import",
        flow: FLOW,
        outcome: projectRef !== undefined || importedThreadCount > 0 ? "continued" : "skipped",
      });
      return finish(projectRef, importWarning, importedThreadCount);
    },
    [environmentId, finish, recordClientEvent],
  );

  const completeAgents = (outcome: "continued" | "skipped") => {
    recordClientEvent(environmentId, {
      event: "onboarding.step.completed",
      step: "agents",
      flow: FLOW,
      outcome,
      readyProviders,
    });
    setTerminalSession(null);
    if (outcome === "continued" && resolveProjectImportOffer(scans) === "offer") {
      setScreen({ kind: "import" });
      return;
    }
    void finish();
  };

  // An agent's own screen is done once that agent works: move on, as V1 did.
  const detailDriver = screen.kind === "agent" ? screen.driver : null;
  const detailState = detailDriver
    ? getOnboardingProviderState(byDriver.get(detailDriver))
    : undefined;
  const advancedFor = useRef<UpComputerOnboardingDriver | null>(null);
  const advance = useEffectEvent((driver: UpComputerOnboardingDriver) => {
    toastManager.add({
      type: "success",
      title: `${AGENT_NAMES[driver]} is ready`,
      description: "You can start a conversation.",
    });
    completeAgents("continued");
  });
  useEffect(() => {
    if (detailDriver === null) {
      advancedFor.current = null;
      return;
    }
    if (detailState !== "ready" || advancedFor.current === detailDriver) return;
    advancedFor.current = detailDriver;
    advance(detailDriver);
  }, [detailDriver, detailState]);

  const back = useCallback(() => {
    if (isImporting) return;
    setTerminalSession(null);
    setScreen({ kind: "agents" });
  }, [isImporting]);

  const openAgent = (driver: UpComputerOnboardingDriver) => {
    const provider = byDriver.get(driver);
    if (driver === "codex" && !codexExistingCli) {
      // "Connect" is the ChatGPT choice: start it instead of asking again.
      changeCodexMode("managed");
      setCodexAutoStart(true);
    } else if (
      provider !== undefined &&
      getOnboardingProviderState(provider) !== "attention" &&
      canOperateTerminal
    ) {
      openTerminal(driver, provider);
    }
    setScreen({ kind: "agent", driver });
  };

  let title: string;
  let description: ReactNode;
  let body: ReactNode;
  if (screen.kind === "import") {
    title = "Import your projects";
    description =
      "Bring the projects you use with Claude Code and Codex into Up.computer, with their recent conversations. Their files are only read, never changed.";
    body = (
      // ImportStep brings its own heading; this screen's header replaces it.
      <div className="[&>div>h1]:hidden [&>h1+p]:hidden [&>h1]:hidden">
        <ImportStep
          scans={scans}
          isImporting={isImporting}
          setIsImporting={setIsImporting}
          onDone={finishImport}
        />
      </div>
    );
  } else if (screen.kind === "agent") {
    const driver = screen.driver;
    const provider = byDriver.get(driver);
    const terminal =
      terminalSession?.driver === driver ? (
        <AgentInstallTerminal
          key={`${terminalSession.providerInstanceId}:${terminalSession.action}`}
          session={terminalSession}
          onClose={() => closeTerminal(terminalSession)}
        />
      ) : null;
    if (driver === "codex" && !codexExistingCli) {
      title = "Connect Codex";
      description =
        "Sign in with your ChatGPT account. Up.computer downloads and updates Codex for you.";
      body =
        serverConfig === null ? (
          <CheckingCard />
        ) : (
          <CodexSetupSection
            presentation="onboarding"
            environmentId={environmentId}
            instanceId={codexInstanceId}
            provider={codexProvider}
            mode={readCodexSetupMode(codexInstance.config)}
            enabled={codexProvider?.enabled ?? true}
            autoStart={codexAutoStart}
            onAutoStartConsumed={() => setCodexAutoStart(false)}
            onModeChange={changeCodexMode}
            onContinueWithChatGpt={() =>
              recordClientEvent(environmentId, {
                event: "onboarding.agent.action",
                provider: ProviderDriverKind.make("codex"),
                action: "continue_with_chatgpt",
              })
            }
          />
        );
    } else {
      title = driver === "codex" ? "Use your Codex CLI" : "Set up Claude Code";
      description =
        driver === "codex"
          ? "Install the Codex command line tool, then sign in with your ChatGPT account."
          : "Install Claude Code, then sign in with your Claude account.";
      body = (
        <CliAgentSteps
          driver={driver}
          provider={provider}
          serverConfig={serverConfig}
          canOperateTerminal={canOperateTerminal}
          terminalOpen={terminal !== null}
          notOnPath={notOnPath.has(driver)}
          onRun={() => provider && openTerminal(driver, provider)}
          onUseChatGpt={
            driver === "codex"
              ? () => {
                  setTerminalSession(null);
                  changeCodexMode("managed");
                  setCodexAutoStart(true);
                }
              : undefined
          }
        >
          {terminal}
        </CliAgentSteps>
      );
    }
  } else {
    title = "Set up an agent";
    description =
      "Up.computer works with the coding agents you already pay for. Connect one to start. You can add more or change this anytime in Settings.";
    body = (
      <AgentTable
        byDriver={byDriver}
        codexExistingCli={codexExistingCli}
        readyProviders={readyProviders}
        onOpen={openAgent}
        onEnable={enableAgent}
        onContinue={() => completeAgents("continued")}
      />
    );
  }

  // A modal dialog like upstream's wizard, so the dialogs it opens (account
  // picker, ChatGPT notice) and toasts stack above it. Escape never closes it:
  // the install terminal inside needs that key.
  return (
    <DialogPrimitive.Root open disablePointerDismissal onOpenChange={(_, event) => event.cancel()}>
      <DialogPrimitive.Portal>
        {/* The route renders inside the command palette's dialog, so this one counts as nested. */}
        <DialogPrimitive.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-background/96 backdrop-blur-md"
        />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden px-3 py-6 sm:px-6 sm:py-12">
          <DialogPrimitive.Popup
            className={`relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-4xl border border-border/70 bg-card shadow-2xl shadow-black/20 outline-none ${screen.kind === "agents" ? "min-h-[min(36rem,100%)]" : ""}`}
          >
            {screen.kind !== "agents" ? (
              <button
                type="button"
                aria-label="Back"
                className={`${ICON_BUTTON_CLASS} absolute top-5 left-5 z-10 sm:top-6 sm:left-6`}
                disabled={isImporting}
                onClick={back}
              >
                <ArrowLeftIcon className="size-4" strokeWidth={2.75} />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Skip setup"
              className={`${ICON_BUTTON_CLASS} absolute top-5 right-5 z-10 sm:top-6 sm:right-6`}
              disabled={isImporting}
              onClick={() =>
                screen.kind === "import" ? void finishImport() : completeAgents("skipped")
              }
            >
              <XIcon className="size-4" strokeWidth={2.75} />
            </button>
            <div className="flex min-h-0 flex-1 flex-col py-6">
              <header
                className={
                  screen.kind === "agents"
                    ? "flex shrink-0 grow basis-auto flex-col justify-center px-14 pb-5 sm:px-16"
                    : "shrink-0 px-14 pt-8 pb-5 sm:px-16"
                }
              >
                <DialogPrimitive.Title className="text-center text-2xl font-semibold tracking-tight text-balance text-foreground">
                  {title}
                </DialogPrimitive.Title>
                <p className="mt-2 text-center text-sm leading-relaxed text-balance text-muted-foreground">
                  {description}
                </p>
              </header>
              <div className="min-h-0 overflow-y-auto px-4 pt-4 pb-2 sm:px-6">{body}</div>
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
      <ChatGptWelcomeCoordinator />
    </DialogPrimitive.Root>
  );
}

function agentTerminalCommand(
  driver: UpComputerOnboardingDriver,
  provider: ServerProvider,
  serverConfig: ServerConfig,
): string {
  const os = serverConfig.environment.platform.os;
  return provider.installed
    ? resolveOnboardingProviderLoginCommand(provider, serverConfig.settings, os)
    : resolveOnboardingProviderInstallCommand(driver, os);
}

function AgentTable({
  byDriver,
  codexExistingCli,
  readyProviders,
  onOpen,
  onEnable,
  onContinue,
}: {
  readonly byDriver: ReadonlyMap<string, ServerProvider>;
  readonly codexExistingCli: boolean;
  readonly readyProviders: number;
  readonly onOpen: (driver: UpComputerOnboardingDriver) => void;
  readonly onEnable: (provider: ServerProvider) => void;
  readonly onContinue: () => void;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <div
          className={`grid gap-2 pb-2 text-3xs font-medium tracking-wider text-muted-foreground uppercase sm:gap-3 ${ROW_GRID}`}
        >
          <span>Agent</span>
          <span className="text-center">Install</span>
          <span className="text-center">Ready</span>
        </div>
        <div className="divide-y divide-border/60 border-t border-border/60">
          {UPCOMPUTER_ONBOARDING_DRIVERS.map((driver) => {
            const provider = byDriver.get(driver);
            const install = resolveAgentInstallCell({ driver, provider, codexExistingCli });
            const ready = resolveAgentReadyCell({ driver, provider });
            return (
              <div key={driver} className={`grid items-center gap-2 py-3 sm:gap-3 ${ROW_GRID}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/70">
                    <ProviderInstanceIcon
                      driverKind={ProviderDriverKind.make(driver)}
                      displayName={AGENT_NAMES[driver]}
                      iconClassName="size-5"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {AGENT_NAMES[driver]}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {describeOnboardingAgent({ driver, provider, codexExistingCli })}
                    </p>
                  </div>
                </div>
                <div className="justify-self-center">
                  {install === "checking" ? (
                    <Checking />
                  ) : install === "install" ? (
                    <button
                      type="button"
                      className={ROW_ACTION_CLASS}
                      onClick={() => onOpen(driver)}
                    >
                      Install
                    </button>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {install === "included" ? "Included" : "Installed"}
                    </span>
                  )}
                </div>
                <div className="justify-self-center">
                  <ReadyCell
                    cell={ready}
                    onOpen={() => onOpen(driver)}
                    onEnable={() => provider && onEnable(provider)}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Cursor, Grok, OpenCode and other agents can be added later in Settings.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        {isProductFeatureShown("usageDataNotice") ? (
          <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
            Up.computer sends us basic usage stats, like the app version and which agent and model
            you use, so we can improve it. It never sends your chats, files or passwords. See our{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              privacy policy
            </a>{" "}
            for details and how to turn this off.
          </p>
        ) : null}
        <button
          type="button"
          className={`${PRIMARY_CLASS} self-end sm:ml-auto`}
          disabled={readyProviders === 0}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function ReadyCell({
  cell,
  onOpen,
  onEnable,
}: {
  readonly cell: ReturnType<typeof resolveAgentReadyCell>;
  readonly onOpen: () => void;
  readonly onEnable: () => void;
}) {
  switch (cell) {
    case "ready":
      return <ReadyMark />;
    case "checking":
      return <Checking />;
    case "install-first":
      return <span className="text-sm text-muted-foreground">Not yet</span>;
    case "enable":
      return (
        <button type="button" className={ROW_ACTION_CLASS} onClick={onEnable}>
          Turn on
        </button>
      );
    default:
      return (
        <button type="button" className={ROW_ACTION_CLASS} onClick={onOpen}>
          {cell === "sign-in" ? "Sign in" : cell === "fix" ? "Fix" : "Connect"}
        </button>
      );
  }
}

/**
 * The steps for an agent set up through its own CLI: install, then sign in,
 * each in the terminal upstream's wizard uses, with the command shown when
 * this connection cannot open one.
 */
function CliAgentSteps({
  driver,
  provider,
  serverConfig,
  canOperateTerminal,
  terminalOpen,
  notOnPath,
  onRun,
  onUseChatGpt,
  children,
}: {
  readonly driver: UpComputerOnboardingDriver;
  readonly provider: ServerProvider | undefined;
  readonly serverConfig: ServerConfig | null;
  readonly canOperateTerminal: boolean;
  readonly terminalOpen: boolean;
  readonly notOnPath: boolean;
  readonly onRun: () => void;
  readonly onUseChatGpt: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const state = getOnboardingProviderState(provider);
  const installed = provider?.installed === true;
  const name = AGENT_NAMES[driver];
  const pendingCommand =
    provider !== undefined && serverConfig !== null && state !== "ready"
      ? agentTerminalCommand(driver, provider, serverConfig)
      : null;
  return (
    <div className="grid gap-4">
      <ol className="divide-y divide-border/60 border-y border-border/60">
        <StepRow
          number={1}
          title={`Install ${driver === "codex" ? "the Codex CLI" : name}`}
          detail={
            notOnPath && !installed
              ? `If the install finished, quit and reopen Up.computer so it can find ${name}.`
              : installed
                ? "Installed on this computer."
                : "Runs the official installer in a terminal here."
          }
          status={
            state === "checking" ? (
              <Checking />
            ) : installed ? (
              <ReadyMark label="Done" />
            ) : (
              <button
                type="button"
                className={ROW_ACTION_CLASS}
                disabled={terminalOpen || !canOperateTerminal || provider === undefined}
                onClick={onRun}
              >
                {terminalOpen ? <LoaderIcon className="size-4 animate-spin" /> : "Install"}
              </button>
            )
          }
        />
        <StepRow
          number={2}
          title={driver === "codex" ? "Sign in with ChatGPT" : "Sign in with Claude"}
          detail={
            state === "ready"
              ? "Signed in."
              : state === "attention"
                ? "Up.computer could not check it. Settings, Providers has the details."
                : state === "disabled"
                  ? "Turned off in Settings."
                  : "Your browser opens to finish signing in."
          }
          status={
            state === "ready" ? (
              <ReadyMark />
            ) : (
              <button
                type="button"
                className={ROW_ACTION_CLASS}
                disabled={terminalOpen || !installed || !canOperateTerminal}
                onClick={onRun}
              >
                {terminalOpen && installed ? (
                  <LoaderIcon className="size-4 animate-spin" />
                ) : (
                  "Sign in"
                )}
              </button>
            )
          }
        />
      </ol>
      {!canOperateTerminal && pendingCommand !== null ? (
        <div className="text-sm text-muted-foreground">
          <p>This connection cannot open a terminal. Run this on the computer:</p>
          <CommandBlock command={pendingCommand} className="mt-2" />
        </div>
      ) : null}
      {children}
      {onUseChatGpt ? (
        <button
          type="button"
          className="justify-self-center text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={onUseChatGpt}
        >
          Sign in with ChatGPT instead, without the CLI
        </button>
      ) : null}
    </div>
  );
}

function StepRow({
  number,
  title,
  detail,
  status,
}: {
  readonly number: number;
  readonly title: string;
  readonly detail: string;
  readonly status: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/70 text-xs font-medium text-muted-foreground tabular-nums">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed break-words text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0">{status}</div>
    </li>
  );
}

function ReadyMark({ label = "Ready" }: { readonly label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-foreground">
      <CheckIcon className="size-4" aria-hidden />
      {label}
    </span>
  );
}

function Checking() {
  return (
    <span className="inline-flex items-center">
      <Skeleton className="h-4 w-16" />
      <span className="sr-only">Checking</span>
    </span>
  );
}

function CheckingCard() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-4">
      <Skeleton className="size-5" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}
