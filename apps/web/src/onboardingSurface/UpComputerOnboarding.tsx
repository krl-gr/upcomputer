import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthTerminalOperateScope,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  toTelemetryProvider,
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
  type AgentTerminalSession,
} from "../components/onboarding/WelcomeWizard";
import { ChatGptWelcomeCoordinator } from "../components/settings/ChatGptWelcomeCoordinator";
import { CodexSetupSection } from "../components/settings/CodexSetupSection";
import { readCodexSetupMode } from "../components/settings/CodexSetupSection.logic";
import { ProviderAuthenticationSection } from "../components/settings/ProviderAuthenticationSection";
import {
  ProviderSetupSection,
  readAntigravityAuthMethod,
} from "../components/settings/ProviderSetupSection";
import { buildProviderInstanceUpdatePatch } from "../components/settings/SettingsPanels.logic";
import { Skeleton } from "../components/ui/skeleton";
import { toastManager } from "../components/ui/toast";
import { useRecordClientEvent } from "../hooks/useRecordClientEvent";
import { useCompleteOnboarding } from "../onboarding/firstRun";
import {
  getOnboardingProviderState,
  resolveOnboardingProviderInstallCommand,
  resolveOnboardingProviderLoginCommand,
  selectOnboardingProvidersByDriver,
} from "../onboarding/providerReadiness.logic";
import { useEnvironments } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import {
  countReadyOnboardingProviders,
  isCodexExistingCliChosen,
  resolveAgentInstallCell,
  resolveAgentReadyCell,
  resolveAgentSignInKind,
  resolveCliInstallCommand,
  resolveCliInstallNote,
  resolveCliLoginCommand,
  UPCOMPUTER_ONBOARDING_AGENTS,
  type UpComputerOnboardingAgent,
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

/** Each agent's own screen: its header, and for CLI agents the two steps. */
const DETAIL_COPY: Record<
  UpComputerOnboardingDriver,
  {
    readonly title: string;
    readonly description: string;
    readonly install?: string;
    readonly installNote?: string;
    readonly signIn?: string;
    readonly signInNote?: string;
  }
> = {
  codex: {
    title: "Use your Codex CLI",
    description: "Install the Codex command line tool, then sign in with your ChatGPT account.",
    install: "Install the Codex CLI",
    signIn: "Sign in with ChatGPT",
  },
  claudeAgent: {
    title: "Set up Claude",
    description: "Install Claude Code, then sign in with your Claude account.",
    install: "Install Claude Code",
    // The installer prints nothing while it downloads, for minutes on a slow network.
    installNote:
      "Runs the official installer in a terminal here. It downloads about 270 MB, which can take a few minutes.",
    signIn: "Sign in with Claude",
  },
  cursor: {
    title: "Connect Cursor",
    description: "Sign in with your Cursor account in the browser.",
  },
  grok: {
    title: "Set up Grok",
    description:
      "Install the Grok CLI, then sign in with the X account that holds your SuperGrok or Premium+ subscription.",
    install: "Install the Grok CLI",
    signIn: "Sign in with your X account",
  },
  opencode: {
    title: "Set up OpenCode",
    description: "Install OpenCode, then connect the model provider you want to use.",
    install: "Install OpenCode",
    signIn: "Connect a model provider",
    signInNote: "Pick a provider in the terminal and sign in or paste its key.",
  },
  antigravity: {
    title: "Set up Antigravity",
    description:
      "Up.computer downloads Google's Antigravity agent, then you sign in with your Google account.",
  },
};

type Screen =
  | { readonly kind: "agents" }
  | { readonly kind: "agent"; readonly driver: UpComputerOnboardingDriver };

const agentFor = (driver: UpComputerOnboardingDriver) =>
  UPCOMPUTER_ONBOARDING_AGENTS.find((agent) => agent.driver === driver)!;

/**
 * V1's first run over upstream's provider logic: a table of agents, each
 * opening its own screen. As soon as one agent works, setup ends and the app
 * opens.
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
  const { environments } = useEnvironments();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "Agent setup settings");
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const recordClientEvent = useRecordClientEvent();
  const completeOnboarding = useCompleteOnboarding();
  const [codexAutoStart, setCodexAutoStart] = useState(false);
  const [terminalSession, setTerminalSession] = useState<AgentTerminalSession | null>(null);
  const [installFailed, setInstallFailed] = useState<ReadonlySet<UpComputerOnboardingDriver>>(
    new Set(),
  );
  // Between Close and the recheck's answer the provider still reads as before.
  const [rechecking, setRechecking] = useState<UpComputerOnboardingDriver | null>(null);

  useEffect(() => {
    void refreshProviders({ environmentId, input: {} });
  }, [environmentId, refreshProviders]);

  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    recordClientEvent(environmentId, {
      event: "onboarding.step.viewed",
      step: "agents",
      flow: FLOW,
    });
  }, [environmentId, recordClientEvent]);

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
      provider: "codex",
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
      provider: toTelemetryProvider(provider.driver),
      action,
    });
    setTerminalSession({
      environmentId,
      // Upstream's session type names only its two agents; the terminal itself takes any.
      driver: driver as AgentTerminalSession["driver"],
      action,
      providerInstanceId: provider.instanceId,
      cwd: serverConfig.cwd,
      command: agentTerminalCommand(driver, provider, serverConfig),
      keybindings: serverConfig.keybindings,
    });
  };

  const recheck = (driver: UpComputerOnboardingDriver) => {
    setRechecking(driver);
    return refreshProviders({ environmentId, input: {} }).then((refreshed) => {
      setRechecking((current) => (current === driver ? null : current));
      return refreshed;
    });
  };

  const closeTerminal = (session: AgentTerminalSession) => {
    setTerminalSession(null);
    const driver = session.driver as UpComputerOnboardingDriver;
    void recheck(driver).then((refreshed) => {
      const provider =
        refreshed._tag === "Success"
          ? refreshed.value.providers.find(
              (entry) => entry.instanceId === session.providerInstanceId,
            )
          : undefined;
      if (provider === undefined) return;
      setInstallFailed((current) => {
        const next = new Set(current);
        if (session.action === "install" && !provider.installed) next.add(driver);
        else next.delete(driver);
        return next;
      });
      recordClientEvent(environmentId, {
        event: "onboarding.agent.terminal_closed",
        provider: toTelemetryProvider(provider.driver),
        action: session.action,
        installed: provider.installed,
        authStatus: provider.auth.status,
      });
    });
  };

  const finishingRef = useRef<Promise<void> | null>(null);
  const finish = useCallback(() => {
    if (finishingRef.current !== null) return;
    const completion = completeOnboarding()
      .then(async () => {
        recordClientEvent(environmentId, {
          event: "onboarding.completed",
          flow: FLOW,
          importedProject: false,
          importedThreads: 0,
        });
        await onDone();
      })
      .catch(() => {
        toastManager.add({
          type: "error",
          title: "Could not finish setup",
          description: "Your settings could not be saved. Try again.",
        });
      })
      .finally(() => {
        if (finishingRef.current === completion) finishingRef.current = null;
      });
    finishingRef.current = completion;
  }, [completeOnboarding, environmentId, onDone, recordClientEvent]);

  const completeAgents = (outcome: "continued" | "skipped") => {
    recordClientEvent(environmentId, {
      event: "onboarding.step.completed",
      step: "agents",
      flow: FLOW,
      outcome,
      readyProviders,
    });
    setTerminalSession(null);
    finish();
  };

  // An agent's own screen is done once that agent works: open the app, as V1 did.
  const detailDriver = screen.kind === "agent" ? screen.driver : null;
  const detailState = detailDriver
    ? getOnboardingProviderState(byDriver.get(detailDriver))
    : undefined;
  const advancedFor = useRef<UpComputerOnboardingDriver | null>(null);
  const advance = useEffectEvent((driver: UpComputerOnboardingDriver) => {
    toastManager.add({
      type: "success",
      title: `${agentFor(driver).name} is ready`,
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

  const back = () => {
    setTerminalSession(null);
    setScreen({ kind: "agents" });
  };

  const openAgent = (agent: UpComputerOnboardingAgent) => {
    const { driver } = agent;
    const provider = byDriver.get(driver);
    const state = getOnboardingProviderState(provider);
    // Choosing to set an agent up turns it on; most start disabled.
    if (provider !== undefined && state === "disabled") enableAgent(provider);
    if (driver === "codex" && !codexExistingCli) {
      // "Connect" is the ChatGPT choice: start it instead of asking again.
      changeCodexMode("managed");
      setCodexAutoStart(true);
    } else if (
      provider !== undefined &&
      resolveAgentSignInKind(agent, codexExistingCli) === "terminal" &&
      (state === "install" || state === "signIn") &&
      canOperateTerminal
    ) {
      openTerminal(driver, provider);
    }
    setScreen({ kind: "agent", driver });
  };

  let title = "Set up agents";
  let description =
    "Install the agents you use and choose the setup that works best for you. Add or change providers anytime in Settings.";
  let body: ReactNode = (
    <AgentTable
      byDriver={byDriver}
      codexExistingCli={codexExistingCli}
      readyProviders={readyProviders}
      onOpen={openAgent}
      onContinue={() => completeAgents("continued")}
    />
  );
  if (screen.kind === "agent") {
    const agent = agentFor(screen.driver);
    const { driver } = agent;
    const provider = byDriver.get(driver);
    const copy = DETAIL_COPY[driver];
    title = copy.title;
    description = copy.description;
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
                provider: "codex",
                action: "continue_with_chatgpt",
              })
            }
          />
        );
    } else if (driver === "cursor" || driver === "antigravity") {
      const environmentLabel =
        environments.find((environment) => environment.environmentId === environmentId)?.label ??
        "This computer";
      const instanceConfig =
        provider === undefined
          ? undefined
          : serverConfig?.settings.providerInstances[provider.instanceId]?.config;
      body =
        provider === undefined ? (
          <CheckingCard />
        ) : driver === "antigravity" ? (
          <ProviderSetupSection
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instanceId={provider.instanceId}
            provider={provider}
            binaryPath={configuredBinaryPath(instanceConfig)}
            authMethod={readAntigravityAuthMethod(instanceConfig)}
            enabled={provider.enabled}
            readOnly={false}
            onEnable={() => enableAgent(provider)}
          />
        ) : provider.setup?.canAuthenticate ? (
          <ProviderAuthenticationSection
            key={provider.instanceId}
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instanceId={provider.instanceId}
            provider={provider}
            readOnly={false}
            openBrowserOnStart
          />
        ) : (
          <CheckingCard />
        );
    } else {
      const terminal =
        terminalSession?.driver === driver ? (
          <AgentInstallTerminal
            key={`${terminalSession.providerInstanceId}:${terminalSession.action}`}
            session={terminalSession}
            onClose={() => closeTerminal(terminalSession)}
          />
        ) : null;
      body = (
        <CliAgentSteps
          driver={driver}
          provider={provider}
          serverConfig={serverConfig}
          canOperateTerminal={canOperateTerminal}
          terminalOpen={terminal !== null}
          rechecking={rechecking === driver}
          installFailed={installFailed.has(driver)}
          onRun={() => provider && openTerminal(driver, provider)}
          onRecheck={() => void recheck(driver)}
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
          <DialogPrimitive.Popup className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-4xl border border-border/70 bg-card shadow-2xl shadow-black/20 outline-none">
            {screen.kind !== "agents" ? (
              <button
                type="button"
                aria-label="Back"
                className={`${ICON_BUTTON_CLASS} absolute top-5 left-5 z-10 sm:top-6 sm:left-6`}
                onClick={back}
              >
                <ArrowLeftIcon className="size-4" strokeWidth={2.75} />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Skip setup"
              className={`${ICON_BUTTON_CLASS} absolute top-5 right-5 z-10 sm:top-6 sm:right-6`}
              onClick={() => completeAgents("skipped")}
            >
              <XIcon className="size-4" strokeWidth={2.75} />
            </button>
            <div className="flex min-h-0 flex-1 flex-col py-6">
              <header className="shrink-0 px-14 pt-2 pb-5 sm:px-16">
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

function configuredBinaryPath(config: unknown): string | undefined {
  if (config === null || typeof config !== "object" || !("binaryPath" in config)) return undefined;
  return typeof config.binaryPath === "string" ? config.binaryPath.trim() : undefined;
}

function agentTerminalCommand(
  driver: UpComputerOnboardingDriver,
  provider: ServerProvider,
  serverConfig: ServerConfig,
): string {
  const os = serverConfig.environment.platform.os;
  if (driver === "grok" || driver === "opencode") {
    return provider.installed
      ? resolveCliLoginCommand(
          driver,
          serverConfig.settings.providerInstances[provider.instanceId]?.config,
        )
      : resolveCliInstallCommand(driver, os);
  }
  const upstreamDriver = driver === "claudeAgent" ? "claudeAgent" : "codex";
  return provider.installed
    ? resolveOnboardingProviderLoginCommand(provider, serverConfig.settings, os)
    : resolveOnboardingProviderInstallCommand(upstreamDriver, os);
}

function AgentTable({
  byDriver,
  codexExistingCli,
  readyProviders,
  onOpen,
  onContinue,
}: {
  readonly byDriver: ReadonlyMap<string, ServerProvider>;
  readonly codexExistingCli: boolean;
  readonly readyProviders: number;
  readonly onOpen: (agent: UpComputerOnboardingAgent) => void;
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
          {UPCOMPUTER_ONBOARDING_AGENTS.map((agent) => {
            const provider = byDriver.get(agent.driver);
            const install = resolveAgentInstallCell({ agent, provider, codexExistingCli });
            const ready = resolveAgentReadyCell({ agent, provider, codexExistingCli });
            return (
              <div
                key={agent.driver}
                className={`grid items-center gap-2 py-3 sm:gap-3 ${ROW_GRID}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/70">
                    <ProviderInstanceIcon
                      driverKind={ProviderDriverKind.make(agent.driver)}
                      displayName={agent.name}
                      iconClassName="size-5"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
                    <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
                      {agent.description}
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
                      onClick={() => onOpen(agent)}
                    >
                      Install
                    </button>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {install === "included"
                        ? "Included"
                        : install === "built-in"
                          ? "Built in"
                          : "Installed"}
                    </span>
                  )}
                </div>
                <div className="justify-self-center">
                  <ReadyCell cell={ready} onOpen={() => onOpen(agent)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className={PRIMARY_CLASS}
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
}: {
  readonly cell: ReturnType<typeof resolveAgentReadyCell>;
  readonly onOpen: () => void;
}) {
  switch (cell) {
    case "ready":
      return <ReadyMark />;
    case "checking":
      return <Checking />;
    case "install-first":
      return <span className="text-sm text-muted-foreground">Not yet</span>;
    default:
      return (
        <button type="button" className={ROW_ACTION_CLASS} onClick={onOpen}>
          {cell === "sign-in" ? "Sign in" : "Connect"}
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
  rechecking,
  installFailed,
  onRun,
  onRecheck,
  onUseChatGpt,
  children,
}: {
  readonly driver: UpComputerOnboardingDriver;
  readonly provider: ServerProvider | undefined;
  readonly serverConfig: ServerConfig | null;
  readonly canOperateTerminal: boolean;
  readonly terminalOpen: boolean;
  readonly rechecking: boolean;
  readonly installFailed: boolean;
  readonly onRun: () => void;
  readonly onRecheck: () => void;
  readonly onUseChatGpt: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const state = getOnboardingProviderState(provider);
  const installed = provider?.installed === true;
  const copy = DETAIL_COPY[driver];
  const pendingCommand =
    provider !== undefined && serverConfig !== null && state !== "ready"
      ? agentTerminalCommand(driver, provider, serverConfig)
      : null;
  return (
    <div className="grid gap-4">
      <ol className="divide-y divide-border/60 border-y border-border/60">
        <StepRow
          number={1}
          title={copy.install ?? "Install"}
          detail={
            installFailed && !installed
              ? "The install did not finish. Run it again."
              : installed
                ? "Installed on this computer."
                : (copy.installNote ??
                  ((driver === "grok" || driver === "opencode") && serverConfig !== null
                    ? resolveCliInstallNote(serverConfig.environment.platform.os)
                    : "Runs the official installer in a terminal here."))
          }
          status={
            state === "checking" || provider === undefined || rechecking ? (
              <Checking />
            ) : installed ? (
              <ReadyMark label="Done" />
            ) : (
              <button
                type="button"
                className={ROW_ACTION_CLASS}
                disabled={terminalOpen || !canOperateTerminal || state === "disabled"}
                onClick={onRun}
              >
                {terminalOpen ? <LoaderIcon className="size-4 animate-spin" /> : "Install"}
              </button>
            )
          }
        />
        <StepRow
          number={2}
          title={copy.signIn ?? "Sign in"}
          detail={
            state === "ready" ? (
              "Signed in."
            ) : state === "attention" ? (
              <>
                Up.computer could not check it. Settings, Providers has the details.{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-2"
                  disabled={rechecking}
                  onClick={onRecheck}
                >
                  Check again
                </button>
              </>
            ) : (
              (copy.signInNote ?? "Your browser opens to finish signing in.")
            )
          }
          status={
            state === "ready" ? (
              <ReadyMark />
            ) : rechecking ? (
              <Checking />
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
  readonly detail: ReactNode;
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
