import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import {
  describeWorkspaceWaiting,
  sortScopedProjectsForSidebar,
} from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { useLegacySidebarEnabled } from "../hooks/useSettings";
import { openScratchHomeDraft, resolveHomeWithoutDraft } from "../scratchHomeDraft";
import { newThreadStartsWithoutProject } from "../sidebarProjects/SidebarThreadsSection";
import {
  readProject,
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
  useWorkspaceKnown,
  useWorkspaceDelivery,
  useWorkspaceSettled,
} from "../state/entities";
import type { WaitingWorkspaceEnvironment } from "../state/workspace";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { APP_DISPLAY_NAME } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedStaticOnboardingState />;
  }

  return <IndexDraftLanding />;
}

function IndexDraftLanding() {
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const workspaceKnown = useWorkspaceKnown();
  const workspaceSettled = useWorkspaceSettled();
  const workspaceDelivery = useWorkspaceDelivery();
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const startsWithoutProject = newThreadStartsWithoutProject(useLegacySidebarEnabled());
  // UpComputer: the scratch project is not known before its environment's
  // server config, so choosing between the most recent project and a chat
  // without a project waits for it. Cached shells are enough for that choice,
  // and the wait ends at the first-load deadline.
  const projectsKnown = startsWithoutProject ? workspaceKnown : bootstrapped;
  const router = useRouter();
  // Read at effect time: this page stays mounted while a navigation away from
  // "/" is still loading, but the router already points at the new location.
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  const startingRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [startState, setStartState] = useState({
    failed: false,
    scratchFailed: false,
    retryRequest: 0,
  });

  const mostRecentProject = useMemo(
    () =>
      projectsKnown
        ? (sortScopedProjectsForSidebar(projects, threads, "updated_at")[0] ?? null)
        : null,
    [projectsKnown, projects, threads],
  );
  // UpComputer: with no projects yet, home is a chat without a project, the
  // draft New thread opens, instead of upstream's "add a project" hero.
  const scratchTarget =
    projectsKnown && mostRecentProject === null && startsWithoutProject && !startState.scratchFailed
      ? scratchEnvironmentId(primaryEnvironmentId)
      : null;

  useEffect(() => {
    // Starting a draft after the user has left would replace the page they picked.
    if (startingRef.current || !isStillOnIndex()) {
      return;
    }
    if (mostRecentProject === null) {
      if (scratchTarget === null) return;
      startingRef.current = true;
      // The scratch project lands in the store before this resolves, so the
      // effect reruns with it as the most recent project; startingRef holds it off.
      void openScratchHomeDraft({
        openScratchProject: () => openScratchProject(scratchTarget),
        isStillHome: () => mountedRef.current && isStillOnIndex(),
        openDraft: (project) =>
          handleNewThread(scopeProjectRef(project.environmentId, project.id), {
            replace: true,
          }),
      })
        .then((outcome) => {
          if (outcome === "opened") return;
          startingRef.current = false;
          if (outcome === "failed") {
            setStartState((state) => ({ ...state, scratchFailed: true }));
          }
        })
        .catch(() => {
          startingRef.current = false;
          setStartState((state) => ({ ...state, scratchFailed: true }));
        });
      return;
    }
    const projectRef = scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id);
    if (readProject(projectRef) === null) {
      return;
    }
    startingRef.current = true;
    void handleNewThread(projectRef, { replace: true })
      .then((opened) => {
        if (opened === null) {
          startingRef.current = false;
          setStartState((state) => ({ ...state, retryRequest: state.retryRequest + 1 }));
        }
      })
      .catch(() => {
        startingRef.current = false;
        setStartState((state) => ({ ...state, failed: true }));
      });
  }, [
    handleNewThread,
    mostRecentProject,
    openScratchProject,
    scratchTarget,
    startState.retryRequest,
  ]);

  // Upstream renders nothing while it waits.
  const pending = startsWithoutProject ? <HomePending /> : null;
  if (!projectsKnown) {
    return pending;
  }
  if (mostRecentProject !== null) {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          setStartState((state) => ({
            ...state,
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : (
      pending
    );
  }
  if (scratchTarget !== null) {
    return <HomePending />;
  }
  // UpComputer: the scratch environment offers a chat once it connects.
  switch (
    resolveHomeWithoutDraft({
      startsWithoutProject,
      workspaceSettled,
      workspaceDelivered: workspaceDelivery.delivered,
    })
  ) {
    case "pending":
      return <HomePending />;
    case "waiting":
      return <HomeWaiting waitingOn={workspaceDelivery.waitingOn} />;
    case "hero":
      // Without a chat to open (no environment offers one, or opening it failed), the hero offers both ways in.
      return <NoProjectsHero />;
  }
}

/**
 * Blank page while home picks its draft. Rendering nothing would leave the
 * window's own background (the macOS vibrancy) where the page then appears.
 */
function HomePending() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
    </SidebarInset>
  );
}

function HomeWaiting({
  waitingOn,
}: {
  readonly waitingOn: ReadonlyArray<WaitingWorkspaceEnvironment>;
}) {
  const { text, unreachable } = describeWorkspaceWaiting(waitingOn);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyDescription>{text}</EmptyDescription>
          {unreachable ? (
            <div className="mt-5 flex justify-center">
              <Button render={<Link to="/settings/connections" />} size="sm" variant="outline">
                Check Connections
              </Button>
            </div>
          ) : null}
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription>
            The project is still available. Try opening the draft again.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon size="md" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

function HostedStaticOnboardingState() {
  const cloudEnabled = hasCloudPublicConfig();
  const localEnvironmentOff = isLocalEnvironmentDisabled();
  const description = localEnvironmentOff
    ? "The local environment is turned off. Connect a remote environment, or turn the local environment back on in Connections."
    : cloudEnabled
      ? "Enable UpComputer Connect on that machine, then open Connections here to sign in with the same account. You can also add the machine using a pairing link."
      : "Open Connections and add that machine using its pairing link. This app must be able to reach it.";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle>Connect to a computer running Up.computer</EmptyTitle>
              <EmptyDescription>
                This app connects to Up.computer running on your computer or a server. Start the
                Up.computer desktop app or command-line server on that machine and keep it running.
              </EmptyDescription>
              <EmptyDescription>{description}</EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Open Connections
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
