import { workspaceAreaProps } from "../lib/workspaceFocus";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { isElectron } from "../env";
import { BlankWorkspacePage } from "../components/BlankWorkspacePage";
import { HostedEmptyState } from "../components/HostedEmptyState";
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

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
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
  // Read at effect time; this page can stay mounted while the router is already navigating away.
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  const startingRef = useRef(false);
  // The project draft starts once per attempt; Retry asks for a new attempt.
  const startedAttemptRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks mount so an async draft start never updates an unmounted route
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

  const mostRecentProject = projectsKnown
    ? (sortScopedProjectsForSidebar(projects, threads, "updated_at")[0] ?? null)
    : null;
  // UpComputer: with no projects yet, home is a chat without a project, the
  // draft New thread opens, instead of upstream's "add a project" hero.
  const scratchTarget =
    projectsKnown && mostRecentProject === null && startsWithoutProject && !startState.scratchFailed
      ? scratchEnvironmentId(primaryEnvironmentId)
      : null;
  const attempt = startState.retryRequest;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts a draft thread in the most recent project and navigates to it while still on the index
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
    if (startedAttemptRef.current === attempt) return;
    const projectRef = scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id);
    if (readProject(projectRef) === null) {
      return;
    }
    startingRef.current = true;
    startedAttemptRef.current = attempt;
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
  }, [attempt, handleNewThread, mostRecentProject, openScratchProject, scratchTarget]);

  // Upstream renders nothing while it waits.
  const pending = startsWithoutProject ? <BlankWorkspacePage /> : null;
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
    return <BlankWorkspacePage />;
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
      return <BlankWorkspacePage />;
    case "waiting":
      return <HomeWaiting waitingOn={workspaceDelivery.waitingOn} />;
    case "hero":
      // Without a chat to open (no environment offers one, or opening it failed), the hero offers both ways in.
      return <NoProjectsHero />;
  }
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
  const contentArea = workspaceAreaProps("home", 1, "Home");
  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
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
