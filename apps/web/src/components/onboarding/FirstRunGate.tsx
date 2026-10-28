import { RefreshIcon } from "~/components/ui/refresh-icon";
import { toastManager } from "~/components/ui/toast";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import {
  ensureClientSettingsHydrated,
  useClientSettings,
  useClientSettingsHydrationStatus,
} from "../../hooks/useSettings";
import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import { useCompleteOnboarding } from "../../onboarding/firstRun";
import { FirstRunAgentStarter } from "../../onboardingSurface/FirstRunAgent";
import { productSurface } from "../../product/productFlags";
import {
  isFirstRunWorkspaceProvenanceAuthoritative,
  isFreshFirstRunWorkspace,
  resolveFirstRunDecision,
  resolveHostedFirstRunDecision,
  transitionFirstRunGateState,
  type FirstRunGateState,
} from "../../onboarding/firstRun.logic";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { environmentProjects } from "../../state/projects";
import { primaryServerConfigAtom, primaryServerWelcomeAtom } from "../../state/server";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";
import { BootSplash } from "../BootSplash";
import { Button } from "../ui/button";

/**
 * Only the boot splash renders while pending: no shell, no EventRouter (whose
 * welcome payload would otherwise navigate into a thread), no dialogs.
 */

const FIRST_RUN_DECISION_TIMEOUT_MS = 4_000;

const primaryShellLiveAtom = Atom.make((get) => {
  const serverConfig = get(primaryServerConfigAtom);
  return (
    serverConfig !== null &&
    get(environmentShell.stateValueAtom(serverConfig.environment.environmentId)).status === "live"
  );
}).pipe(Atom.withLabel("web-onboarding-primary-shell-live"));

const workspaceEvidenceLiveAtom = Atom.make((get) => {
  const environmentIds = new Set([
    ...get(environmentProjects.projectsAtom).map((project) => project.environmentId),
    ...get(environmentThreadShells.threadShellsAtom).map((thread) => thread.environmentId),
  ]);

  for (const environmentId of environmentIds) {
    if (get(environmentShell.stateValueAtom(environmentId)).status !== "live") {
      return false;
    }
  }

  return true;
}).pipe(Atom.withLabel("web-onboarding-workspace-evidence-live"));

export function FirstRunGate({
  enabled,
  hostedStatic,
  children,
}: {
  readonly enabled: boolean;
  readonly hostedStatic: boolean;
  readonly children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const hydrationStatus = useClientSettingsHydrationStatus();
  const hydrated = hydrationStatus === "ready";
  const completeOnboarding = useCompleteOnboarding();
  const onboardingCompletedAt = useClientSettings((settings) => settings.onboardingCompletedAt);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const { environments, isReady: environmentCatalogReady } = useEnvironments();
  const projects = useProjects();
  const threads = useThreadShells();
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const primaryShellLive = useAtomValue(primaryShellLiveAtom);
  const workspaceEvidenceLive = useAtomValue(workspaceEvidenceLiveAtom);
  const [gateState, setGateState] = useState<FirstRunGateState>(() => ({
    decision:
      (!enabled && !hostedStatic) || (hydrated && onboardingCompletedAt !== null)
        ? "app"
        : "pending",
    stalled: false,
  }));
  const { decision, stalled } = gateState;
  const settingsReadFailed = hydrationStatus === "failed" || hydrationStatus === "retrying";
  // A workspace still counts as fresh when its only content is the server's own
  // cwd auto-bootstrap: web mode creates a project + thread from cwd at startup
  // (`autoBootstrapProjectFromCwd` defaults on there), so "no projects at all"
  // would mean `npx t3` users never see the wizard.
  const serverCwd = serverConfig?.cwd ?? null;
  const primaryEnvironmentId = serverConfig?.environment.environmentId ?? null;
  const workspaceFresh = isFreshFirstRunWorkspace({
    primaryEnvironmentId,
    serverCwd,
    bootstrapProjectId: serverWelcome?.bootstrapProjectId,
    bootstrapThreadId: serverWelcome?.bootstrapThreadId,
    bootstrapProjectCreated: serverWelcome?.bootstrapProjectCreated,
    bootstrapThreadCreated: serverWelcome?.bootstrapThreadCreated,
    projects,
    threads,
  });

  const { decision: nextDecision, persistCompletion } = hostedStatic
    ? resolveHostedFirstRunDecision({
        localEnvironmentDisabled: isLocalEnvironmentDisabled(),
        hydrated,
        completed: onboardingCompletedAt !== null,
        catalogReady: environmentCatalogReady,
        environmentCount: environments.length,
      })
    : resolveFirstRunDecision({
        enabled,
        hydrated,
        completed: onboardingCompletedAt !== null,
        bootstrapped,
        authoritative: primaryShellLive,
        workspaceAuthoritative: workspaceEvidenceLive,
        workspaceProvenanceAuthoritative: isFirstRunWorkspaceProvenanceAuthoritative({
          welcomeReceived: serverWelcome !== null,
          bootstrapStatus: serverWelcome?.bootstrapStatus ?? null,
        }),
        catalogReady: environmentCatalogReady,
        serverConfigAvailable: serverConfig !== null,
        workspaceFresh,
        projectCount: projects.length,
        threadCount: threads.length,
      });

  useEffect(() => {
    if (decision === "wizard" || !hydrated) return;

    if (persistCompletion && onboardingCompletedAt === null) {
      void completeOnboarding().catch(() =>
        toastManager.add({
          type: "warning",
          title: "Setup wasn't saved",
          description:
            "Up.computer couldn't save that setup is finished, so you might see it again. Your projects are not affected.",
        }),
      );
    }

    setGateState((state) =>
      transitionFirstRunGateState(state, { type: "evidence", decision: nextDecision }),
    );
  }, [
    completeOnboarding,
    decision,
    hydrated,
    nextDecision,
    onboardingCompletedAt,
    persistCompletion,
  ]);

  useEffect(() => {
    if (!enabled || decision !== "pending" || !hydrated) return;
    const timer = window.setTimeout(
      () => setGateState((state) => transitionFirstRunGateState(state, { type: "timeout" })),
      FIRST_RUN_DECISION_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [decision, enabled, hydrated]);

  // UpComputer: a new user lands in the app while it sets up OpenCode; the
  // agent table stays at /welcome for connecting other agents.
  const installsFirstAgent =
    decision === "wizard" &&
    !hostedStatic &&
    primaryEnvironmentId !== null &&
    productSurface("onboarding") === "upcomputer";

  useEffect(() => {
    if (decision === "wizard" && !installsFirstAgent && pathname !== "/welcome") {
      void navigate({ to: "/welcome", replace: true });
    }
  }, [decision, installsFirstAgent, navigate, pathname]);

  if (settingsReadFailed) {
    return <FirstRunRecovery reason="settings" retrying={hydrationStatus === "retrying"} />;
  }
  if (installsFirstAgent) {
    return (
      <>
        <FirstRunAgentStarter environmentId={primaryEnvironmentId} />
        {children}
      </>
    );
  }
  if (decision !== "app") {
    return stalled ? <FirstRunRecovery reason="connection" /> : <BootSplash />;
  }
  return children;
}

function FirstRunRecovery({
  reason,
  retrying = false,
}: {
  readonly reason: "settings" | "connection";
  readonly retrying?: boolean;
}) {
  const settingsReadFailed = reason === "settings";
  return (
    <main className="flex h-dvh min-h-0 items-center justify-center bg-background px-6 text-foreground">
      <div className="flex max-w-sm flex-col items-center text-center">
        <h1 className="text-lg font-semibold">
          {settingsReadFailed
            ? "Couldn't read your settings"
            : "Up.computer is taking too long to start"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {settingsReadFailed
            ? "Your saved settings couldn't be loaded. Try again, and restart the app if it keeps happening."
            : "Up.computer on this computer hasn't answered yet. Reload, and if it keeps happening, restart the app."}
        </p>
        <Button
          className="mt-5"
          size="sm"
          variant="outline"
          disabled={retrying}
          onClick={() => {
            if (settingsReadFailed) {
              void ensureClientSettingsHydrated().catch(() => undefined);
            } else {
              window.location.reload();
            }
          }}
        >
          <RefreshIcon refreshing={retrying} />
          {settingsReadFailed ? "Retry" : "Reload"}
        </Button>
      </div>
    </main>
  );
}
