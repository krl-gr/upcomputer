import { Outlet, createFileRoute, redirect, useLocation, useParams } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useClientSettings } from "../hooks/useSettings";
import { openCommandPalette } from "../commandPaletteBus";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { resolveAvailableSidebarViewMode } from "../components/sidebar/sidebarViewMode";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  startNewLocalThreadInWorkspacePanelFromContext,
  startNewThreadInWorkspacePanelFromContext,
} from "../lib/chatThreadActions";
import { isPreviewFocused } from "../lib/previewFocus";
import { resolveShortcutCommand } from "../keybindings";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";
import {
  ChatWorkspace,
  type ChatWorkspaceRouteTarget,
} from "../components/workspace/ChatWorkspace";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useThreadDetail, useThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { useEnvironments } from "../state/environments";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const storedSidebarViewMode = useClientSettings((settings) => settings.sidebarViewMode);
  const sidebarViewMode = resolveAvailableSidebarViewMode(storedSidebarViewMode);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupCount = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }).length,
    [primaryEnvironmentId, projectGroupingSettings, projects],
  );
  // The `previewOpen` shortcut-context flag here uses the store-only value;
  // the URL-aware arbitration lives inside ChatView's `onTogglePreview`,
  // which we invoke via the action bus to avoid duplicating the rule.
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          previewFocus: isPreviewFocused(),
          previewOpen,
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewLocalThreadInWorkspacePanelFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // Sidebar v2 routes creation through the command palette whenever
        // there is a real choice to make; nested/focused (and single-project
        // setups) keep the immediate contextual create.
        if (sidebarViewMode === "v2" && projectGroupCount > 1) {
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        void startNewThreadInWorkspacePanelFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "preview.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!routeThreadRef) return;
        if (!isPreviewSupportedInRuntime()) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open Up.computer in the desktop app to use the in-app preview.",
            }),
          );
          return;
        }
        dispatchPreviewAction("toggle-panel");
        return;
      }

      // The remaining preview commands only fire when the panel is the
      // currently-focused tenant. The `when: previewFocus` rule already
      // gates this, but defend against the keybinding being misconfigured.
      if (
        command === "preview.refresh" ||
        command === "preview.focusUrl" ||
        command === "preview.zoomIn" ||
        command === "preview.zoomOut" ||
        command === "preview.resetZoom"
      ) {
        event.preventDefault();
        event.stopPropagation();
        const action =
          command === "preview.refresh"
            ? "refresh"
            : command === "preview.focusUrl"
              ? "focus-url"
              : command === "preview.zoomIn"
                ? "zoom-in"
                : command === "preview.zoomOut"
                  ? "zoom-out"
                  : "reset-zoom";
        dispatchPreviewAction(action);
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    previewOpen,
    projectGroupCount,
    routeThreadRef,
    selectedThreadKeysSize,
    sidebarViewMode,
  ]);

  return null;
}

function useChatWorkspaceRouteTarget(): ChatWorkspaceRouteTarget | null {
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const serverRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const shell = useEnvironmentQuery(
    serverRef === null ? null : environmentShell.stateAtom(serverRef.environmentId),
  );
  const serverShell = useThreadShell(serverRef);
  const serverDetail = useThreadDetail(serverRef);
  const draftId = routeTarget?.kind === "draft" ? DraftId.make(routeTarget.draftId) : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  const serverDraft = useComposerDraftStore((store) =>
    serverRef ? store.getDraftThreadByRef(serverRef) : null,
  );

  if (routeTarget?.kind === "server" && serverRef) {
    const bootstrapComplete = shell.data?.snapshot._tag === "Some";
    if (!bootstrapComplete || (!serverShell && !serverDetail && !serverDraft)) return null;
    return { target: { kind: "thread", ref: serverRef } };
  }

  if (routeTarget?.kind === "draft" && draftId && draftSession) {
    return {
      target: {
        kind: "draft",
        draftId,
        ref: {
          environmentId: draftSession.environmentId,
          threadId: draftSession.threadId,
        },
      },
    };
  }

  return null;
}

function ChatRouteLayout() {
  const routeTarget = useChatWorkspaceRouteTarget();
  const { authGateState } = Route.useRouteContext();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  const showHostedStaticOnboarding =
    authGateState.status === "hosted-static" && environments.length === 0 && pathname === "/";

  if (showHostedStaticOnboarding) {
    return (
      <>
        <ChatRouteGlobalShortcuts />
        <Outlet />
      </>
    );
  }

  return (
    <>
      <ChatRouteGlobalShortcuts />
      <ChatWorkspace routeTarget={routeTarget}>
        <Outlet />
      </ChatWorkspace>
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
