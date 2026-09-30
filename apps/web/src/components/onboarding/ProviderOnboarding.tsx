"use client";

import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
} from "@upcomputer/contracts";
import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, CheckIcon, CopyIcon, LoaderIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useWebProductComposition } from "../../product/WebComposition";
import { usePrimaryEnvironment } from "../../state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { buildProviderInstanceUpdatePatch } from "../settings/SettingsPanels.logic";
import {
  getProviderClientDefinitions,
  sortProviderClientDefinitionsForOnboarding,
  type DriverOption,
} from "../settings/providerDriverMeta";
import { ProjectImportPanel } from "./ProjectImportPanel";
import {
  getProviderOnboardingRowState,
  type ProviderOnboardingRowState,
} from "./providerOnboarding.logic";
import {
  DEV_ONBOARDING_SCENARIOS,
  devOnboardingInitialAgents,
  devOnboardingInitialOutcome,
  readDevOnboardingScenario,
  type DevOnboardingOutcome,
  type DevOnboardingScenario,
} from "./providerOnboardingFixture";

export type ProviderOnboardingStep = "agents" | "import";

interface ProviderOnboardingProps {
  /** `import` opens straight on project import, for machines whose agents already work. */
  readonly initialStep?: ProviderOnboardingStep;
  readonly onFinished: () => void;
  readonly onClose: () => void;
  readonly onSkip: () => void;
}

const UPCOMPUTER_DRIVER = ProviderDriverKind.make("up");
const ROW_GRID = "grid-cols-[minmax(0,60%)_6rem_6rem] justify-between";
const ROW_ACTION_BUTTON_CLASS =
  "flex h-8 w-24 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#d4d4d4] px-3 text-sm font-medium text-[#171717] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.17),inset_0_1px_1px_white] transition-transform duration-150 hover:scale-105 disabled:pointer-events-none disabled:opacity-40 not-dark:bg-[#222222] not-dark:text-white not-dark:shadow-[inset_0_-1px_1px_rgba(255,255,255,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)]";

interface AgentRow {
  readonly option: DriverOption;
  readonly driver: string;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly live: ServerProvider | undefined;
  readonly builtIn: boolean;
  readonly installed: boolean;
  readonly state: ProviderOnboardingRowState;
  readonly ready: boolean;
  /** The driver ships an in-app connection flow onboarding can host in a popup. */
  readonly connectable: boolean;
}

/**
 * Sign-in help for an agent that authenticates through its own CLI. These
 * drivers ship no in-app flow, so `Connect` can only hand over the exact
 * command — which is still an action, unlike a bare "not signed in" label.
 */
function SignInPopup({
  label,
  signIn,
  onClose,
}: {
  readonly label: string;
  readonly signIn: NonNullable<DriverOption["signIn"]>;
  readonly onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border/70 bg-card p-5 shadow-2xl shadow-black/30">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close"
          className="absolute end-2 top-2"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
        <h2 className="pr-8 text-base font-semibold text-foreground">Sign in to {label}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{signIn.instructions}</p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 p-2">
          <code className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-foreground">
            {signIn.command}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(signIn.command).then(() => setCopied(true));
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReadyCell({
  row,
  busy,
  onConnect,
  onEnable,
}: {
  readonly row: AgentRow;
  readonly busy: boolean;
  readonly onConnect: () => void;
  readonly onEnable: () => void;
}) {
  if (row.ready) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
        <CheckIcon className="size-4" aria-hidden />
        Ready
      </span>
    );
  }

  switch (row.state) {
    case "checking":
      return (
        <span className="inline-flex items-center gap-2">
          <Skeleton className="h-4 w-16 rounded-full" />
          <span className="sr-only">Checking this agent</span>
        </span>
      );
    case "not-installed":
      return (
        <span className="text-sm text-muted-foreground" title="Install this agent first">
          —
        </span>
      );
    case "disabled":
      return (
        <button
          type="button"
          className={ROW_ACTION_BUTTON_CLASS}
          disabled={busy}
          onClick={onEnable}
        >
          Enable
        </button>
      );
    case "needs-auth":
    case "needs-models":
      return row.connectable || row.option.signIn ? (
        <button type="button" className={ROW_ACTION_BUTTON_CLASS} onClick={onConnect}>
          Connect
        </button>
      ) : (
        <span className="text-sm text-muted-foreground">
          {row.state === "needs-auth" ? "Not signed in" : "No models"}
        </span>
      );
    default:
      return <span className="text-sm text-muted-foreground">Unavailable</span>;
  }
}

function InstallCell({
  row,
  busy,
  onInstall,
}: {
  readonly row: AgentRow;
  readonly busy: boolean;
  readonly onInstall: () => void;
}) {
  if (row.builtIn) return <span className="text-sm text-muted-foreground">Built in</span>;
  if (row.installed) return <span className="text-sm text-muted-foreground">Installed</span>;
  if (!row.live) return <span className="text-sm text-muted-foreground">Unavailable</span>;
  return (
    <button type="button" className={ROW_ACTION_BUTTON_CLASS} disabled={busy} onClick={onInstall}>
      {busy ? <LoaderIcon className="size-4 animate-spin" /> : null}
      {busy ? "Installing…" : "Install"}
    </button>
  );
}

export function ProviderOnboarding({
  initialStep = "agents",
  onFinished,
  onClose,
  onSkip,
}: ProviderOnboardingProps) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const environment = usePrimaryEnvironment();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const composition = useWebProductComposition();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, { reportFailure: false });
  const initialDevScenario = readDevOnboardingScenario();
  const [devScenario, setDevScenario] = useState<DevOnboardingScenario | null>(initialDevScenario);
  const [devOutcome, setDevOutcome] = useState<DevOnboardingOutcome>(() =>
    initialDevScenario ? devOnboardingInitialOutcome(initialDevScenario) : "success",
  );
  const [devAgents, setDevAgents] = useState<
    Record<string, "not-installed" | "installed" | "ready">
  >(() => (initialDevScenario ? devOnboardingInitialAgents(initialDevScenario) : {}));
  const [connectionReady, setConnectionReady] = useState<Record<string, boolean>>({});
  const [connectionDriver, setConnectionDriver] = useState<string>();
  const [signInDriver, setSignInDriver] = useState<string>();
  const [busyDrivers, setBusyDrivers] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [connectionTitle, setConnectionTitle] = useState("Connect UpComputer Agent");
  const [connectionSubtitle, setConnectionSubtitle] = useState(
    "Choose a subscription or API key to connect your models.",
  );
  const [connectionDetailStep, setConnectionDetailStep] = useState(false);
  const [onboardingBackRequest, setOnboardingBackRequest] = useState(0);
  const [step, setStep] = useState<ProviderOnboardingStep>(initialStep);
  const fixtureEnabled = devScenario !== null;

  const resetDevScenario = (scenario: DevOnboardingScenario) => {
    setDevScenario(scenario);
    setDevOutcome(devOnboardingInitialOutcome(scenario));
    setDevAgents(devOnboardingInitialAgents(scenario));
    setConnectionReady({});
    setConnectionDriver(undefined);
    setSignInDriver(undefined);
    setBusyDrivers({});
    setErrors({});
    if (scenario === "already-ready") onFinished();
  };

  const options = useMemo(
    () => sortProviderClientDefinitionsForOnboarding(getProviderClientDefinitions(composition)),
    [composition],
  );

  // Every driver the build ships gets a row. Server data drives each row's
  // state — never its visibility — so a clean machine still sees the agents it
  // could install instead of a single built-in card.
  const rows: ReadonlyArray<AgentRow> = options.map((option) => {
    const driver = String(option.value);
    const live = providers.find((provider) => provider.driver === option.value);
    const instanceId = live?.instanceId ?? defaultInstanceIdForDriver(option.value);
    const instance: ProviderInstanceConfig =
      settings.providerInstances?.[instanceId] ??
      ({ driver: option.value, enabled: true } as ProviderInstanceConfig);
    const builtIn = option.value === UPCOMPUTER_DRIVER;
    const connectable = (option.onboardingDetails ?? option.connectionDetails) !== undefined;
    const fixtureStatus = devAgents[driver] ?? (builtIn ? "installed" : "not-installed");
    const state = fixtureEnabled
      ? fixtureStatus === "ready"
        ? "ready"
        : fixtureStatus === "installed"
          ? "needs-auth"
          : "not-installed"
      : getProviderOnboardingRowState(live);
    return {
      option,
      driver,
      instanceId,
      instance,
      live,
      builtIn,
      installed: fixtureEnabled ? fixtureStatus !== "not-installed" : (live?.installed ?? false),
      state,
      ready: state === "ready" || connectionReady[driver] === true,
      connectable,
    };
  });

  const refresh = useCallback(() => {
    if (!environment) return;
    void refreshProviders({ environmentId: environment.environmentId, input: {} });
  }, [environment, refreshProviders]);

  const closeSignIn = useCallback(() => {
    setSignInDriver(undefined);
    // The login happened outside the app, so re-probe on the way out — a
    // successful sign-in should turn the row green without a reload.
    refresh();
  }, [refresh]);

  const closeConnection = useCallback(() => {
    setConnectionDriver(undefined);
    setConnectionTitle("Connect UpComputer Agent");
    setConnectionSubtitle("Choose a subscription or API key to connect your models.");
    setConnectionDetailStep(false);
    refresh();
  }, [refresh]);

  // Agents are set up: offer project import next. Without an environment
  // there is nothing to scan, so finish directly.
  const finishAgents = useCallback(() => {
    setConnectionDriver(undefined);
    if (environment === null) {
      onFinished();
      return;
    }
    setStep("import");
  }, [environment, onFinished]);

  const handleOnboardingStepChange = useCallback(
    (title: string, detailStep: boolean, subtitle: string) => {
      setConnectionTitle(title);
      setConnectionSubtitle(subtitle);
      setConnectionDetailStep(detailStep);
    },
    [],
  );

  // Escape closes the active popup first, then the screen.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      if (signInDriver !== undefined) {
        closeSignIn();
        return;
      }
      if (connectionDriver !== undefined) {
        closeConnection();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeConnection, closeSignIn, connectionDriver, onClose, signInDriver]);

  const setBusy = (driver: string, busy: boolean) =>
    setBusyDrivers((current) => ({ ...current, [driver]: busy }));
  const setError = (driver: string, message?: string) =>
    setErrors((current) => {
      if (message !== undefined) return { ...current, [driver]: message };
      if (current[driver] === undefined) return current;
      const next = { ...current };
      delete next[driver];
      return next;
    });

  const installAgent = async (row: AgentRow) => {
    if (fixtureEnabled) {
      setBusy(row.driver, true);
      setError(row.driver);
      if (devOutcome === "loading") return;
      window.setTimeout(() => {
        setBusy(row.driver, false);
        if (devOutcome === "fail") {
          setError(row.driver, `Could not install ${row.option.label}.`);
          return;
        }
        if (devOutcome === "cancel") {
          setError(row.driver, `${row.option.label} installation was cancelled.`);
          return;
        }
        setDevAgents((current) => ({ ...current, [row.driver]: "installed" }));
      }, 650);
      return;
    }

    // Drivers with in-app setup (Antigravity) install from their own panel,
    // which shows download progress and continues straight into sign-in.
    if (row.connectable && row.live?.setup?.canInstall) {
      openConnection(row);
      return;
    }

    if (!environment || !row.live) {
      setError(row.driver, `${row.option.label} is not available in this environment.`);
      return;
    }
    if (row.live.installed) return;

    setBusy(row.driver, true);
    setError(row.driver);
    const result = await updateProvider({
      environmentId: environment.environmentId,
      input: { provider: row.option.value, instanceId: row.live.instanceId },
    });
    setBusy(row.driver, false);
    if (result._tag === "Failure") {
      setError(row.driver, `Could not install ${row.option.label}.`);
      return;
    }
    refresh();
  };

  // `enabled` never gets a column of its own — a disabled agent that is
  // otherwise ready is one click away, in the same cell that would hold its
  // checkmark.
  const enableAgent = (row: AgentRow) => {
    if (fixtureEnabled) {
      setDevAgents((current) => ({ ...current, [row.driver]: "ready" }));
      return;
    }
    setError(row.driver);
    updateSettings(
      buildProviderInstanceUpdatePatch({
        settings,
        instanceId: row.instanceId,
        instance: { ...row.instance, enabled: true },
        driver: row.option.value,
        isDefault: row.instanceId === defaultInstanceIdForDriver(row.option.value),
      }),
    );
    refresh();
  };

  // Opening in-app setup is an explicit choice to use the agent, so a
  // disabled-by-default driver (Antigravity) is enabled on the way in.
  function openConnection(row: AgentRow) {
    if (!fixtureEnabled && row.live?.setup !== undefined && !row.live.enabled) {
      enableAgent(row);
    }
    setConnectionDriver(row.driver);
  }

  const signInRow = rows.find((row) => row.driver === signInDriver);
  const connectionRow = rows.find((row) => row.driver === connectionDriver);
  const ConnectionDetails =
    connectionRow?.option.onboardingDetails ?? connectionRow?.option.connectionDetails;
  const importEnvironmentId =
    step === "import" && connectionRow === undefined ? environment?.environmentId : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background/96 px-4 py-12 backdrop-blur-md sm:px-6">
      {devScenario ? (
        <aside className="fixed right-3 bottom-3 z-[110] grid w-64 gap-2 rounded-xl border border-warning/40 bg-card/95 p-3 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-warning">
              Onboarding fixture
            </p>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Reset fixture"
              onClick={() => resetDevScenario(devScenario)}
            >
              <RotateCcwIcon className="size-3" />
            </Button>
          </div>
          <Select
            value={devScenario}
            onValueChange={(value) => resetDevScenario(value as DevOnboardingScenario)}
          >
            <SelectTrigger size="xs" aria-label="Fixture scenario">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {DEV_ONBOARDING_SCENARIOS.map((scenario) => (
                <SelectItem key={scenario} value={scenario}>
                  {scenario}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Select
            value={devOutcome}
            onValueChange={(value) => setDevOutcome(value as DevOnboardingOutcome)}
          >
            <SelectTrigger size="xs" aria-label="Next fixture action">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="success">Next action: success</SelectItem>
              <SelectItem value="fail">Next action: fail</SelectItem>
              <SelectItem value="cancel">Next action: cancel</SelectItem>
              <SelectItem value="loading">Next action: stay loading</SelectItem>
            </SelectPopup>
          </Select>
        </aside>
      ) : null}
      <main className="mx-auto w-full max-w-3xl">
        <section className="relative flex h-[calc(100vh-6rem)] w-full flex-col overflow-hidden rounded-[32px] border border-border/70 bg-card shadow-2xl shadow-black/20">
          {connectionRow ? (
            <button
              type="button"
              aria-label="Back"
              className="absolute top-6 left-6 z-10 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#d4d4d4] text-[#171717] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.17),inset_0_1px_1px_white] transition-transform duration-150 hover:scale-105 not-dark:bg-[#222222] not-dark:text-white not-dark:shadow-[inset_0_-1px_1px_rgba(255,255,255,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)]"
              onClick={() => {
                if (connectionDetailStep) setOnboardingBackRequest((value) => value + 1);
                else closeConnection();
              }}
            >
              <ArrowLeftIcon className="size-4" strokeWidth={2.75} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Skip setup"
            className="absolute top-6 right-6 z-10 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#d4d4d4] text-[#171717] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.17),inset_0_1px_1px_white] transition-transform duration-150 hover:scale-105 not-dark:bg-[#222222] not-dark:text-white not-dark:shadow-[inset_0_-1px_1px_rgba(255,255,255,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)]"
            onClick={onSkip}
          >
            <XIcon className="size-4" strokeWidth={2.75} />
          </button>
          <div
            className={
              connectionRow
                ? "my-auto flex max-h-full w-full flex-col py-6"
                : "flex h-full max-h-full w-full flex-col py-6"
            }
          >
            <header
              className={
                connectionRow || importEnvironmentId
                  ? "shrink-0 px-16 pb-5"
                  : "flex grow shrink-0 basis-auto flex-col justify-center px-16 pb-5"
              }
            >
              <h1 className="truncate text-center text-2xl font-semibold tracking-tight text-foreground">
                {importEnvironmentId
                  ? "Import your projects"
                  : connectionRow
                    ? connectionTitle
                    : "Set up agents"}
              </h1>
              <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
                {importEnvironmentId
                  ? "Bring the projects you use with Claude Code and Codex into UpComputer, with their recent conversations. You can continue those conversations here. Your Claude Code and Codex files are only read, never changed."
                  : connectionRow
                    ? connectionSubtitle
                    : "UpComputer includes a built-in agent you can connect to your preferred subscription or API key. You can also install other agents and choose the setup that works best for you. Add or change providers anytime in Settings."}
              </p>
            </header>
            <div
              className={
                importEnvironmentId
                  ? "flex min-h-0 flex-1 flex-col px-6 pt-4 pb-2"
                  : "min-h-0 overflow-y-auto px-6 pt-4 pb-6"
              }
            >
              {importEnvironmentId ? (
                <ProjectImportPanel
                  className="flex-1"
                  environmentId={importEnvironmentId}
                  skipLabel="Skip"
                  onSkip={onFinished}
                  onDone={(summary) => {
                    if (summary.warning !== null) {
                      toastManager.add(
                        stackedThreadToast({
                          type: "warning",
                          title: "Some history was not imported",
                          description: summary.warning,
                        }),
                      );
                    } else if (summary.importedThreadCount > 0) {
                      toastManager.add(
                        stackedThreadToast({
                          type: "success",
                          title: `Imported ${summary.importedThreadCount} ${summary.importedThreadCount === 1 ? "conversation" : "conversations"}`,
                        }),
                      );
                    }
                    // Stay on this step so the panel can continue a partial import.
                    if (summary.remainingThreadCount === 0) onFinished();
                  }}
                />
              ) : connectionRow && ConnectionDetails ? (
                <div className="min-h-0">
                  <ConnectionDetails
                    key={connectionRow.instanceId}
                    environmentId={environment?.environmentId}
                    instanceId={connectionRow.instanceId}
                    instance={connectionRow.instance}
                    liveProvider={connectionRow.live}
                    refreshProviderStatus={refresh}
                    onOnboardingStepChange={handleOnboardingStepChange}
                    onboardingBackRequest={onboardingBackRequest}
                    onConnectionStateChange={(ready) => {
                      setConnectionReady((current) =>
                        current[connectionRow.driver] === ready
                          ? current
                          : { ...current, [connectionRow.driver]: ready },
                      );
                      if (!ready) return;
                      toastManager.add(
                        stackedThreadToast({
                          type: "success",
                          title: fixtureEnabled ? "Demo connection complete" : "Models connected",
                          description: fixtureEnabled
                            ? "Preview only — no account was connected."
                            : "You're ready to start a conversation.",
                        }),
                      );
                      finishAgents();
                    }}
                    {...(fixtureEnabled ? { onboardingFixtureOutcome: devOutcome } : {})}
                  />
                </div>
              ) : (
                <div className="grid gap-6">
                  <div>
                    <div
                      className={`grid gap-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:gap-3 ${ROW_GRID}`}
                    >
                      <span>Agent</span>
                      <span className="text-center">Install</span>
                      <span className="text-center">Ready</span>
                    </div>
                    <div className="divide-y divide-border/60 border-t border-border/60">
                      {rows.map((row) => {
                        const Icon = row.option.icon;
                        const label = row.builtIn ? "UpComputer Agent" : row.option.label;
                        const busy = busyDrivers[row.driver] === true;
                        const error = errors[row.driver];

                        return (
                          <div key={row.driver} className="py-3">
                            <div className={`grid items-center gap-2 sm:gap-3 ${ROW_GRID}`}>
                              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/70">
                                  <Icon className="size-5 text-foreground/80" aria-hidden />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {label}
                                  </p>
                                  <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
                                    {row.option.onboardingDescription ??
                                      "Use this agent in UpComputer."}
                                  </p>
                                </div>
                              </div>
                              <div className="justify-self-center">
                                <InstallCell
                                  row={row}
                                  busy={busy}
                                  onInstall={() => void installAgent(row)}
                                />
                              </div>
                              <div className="justify-self-center">
                                <ReadyCell
                                  row={row}
                                  busy={busy}
                                  onConnect={() => {
                                    if (row.connectable) {
                                      openConnection(row);
                                      return;
                                    }
                                    setSignInDriver(row.driver);
                                  }}
                                  onEnable={() => enableAgent(row)}
                                />
                              </div>
                            </div>

                            {error ? (
                              <p className="mt-2 text-xs text-destructive">{error}</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button disabled={!rows.some((row) => row.ready)} onClick={finishAgents}>
                      Continue
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      {signInRow?.option.signIn ? (
        <SignInPopup
          label={signInRow.builtIn ? "UpComputer Agent" : signInRow.option.label}
          signIn={signInRow.option.signIn}
          onClose={closeSignIn}
        />
      ) : null}
    </div>
  );
}
