import { useAtomValue } from "@effect/atom-react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, EllipsisIcon, PlusIcon, XIcon } from "lucide-react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
  type SerializedDockview,
} from "dockview";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import {
  useCreateDraftThreadState,
  useHandleNewThread,
  type NewThreadOptions,
} from "../../hooks/useHandleNewThread";
import { shortcutLabelForCommand } from "../../keybindings";
import { resolveThreadActionProjectRef } from "../../lib/chatThreadActions";
import { cn, isMacPlatform } from "../../lib/utils";
import { useThread } from "../../state/entities";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../../threadRoutes";
import {
  EMPTY_CHAT_WORKSPACE_STATE,
  readPersistedChatWorkspaceState,
  writePersistedChatWorkspaceState,
  type PersistedChatWorkspaceStateV1,
} from "../../workspace/workspacePersistence";
import {
  resolveWorkspacePanelIdForOpenRequest,
  useChatWorkspaceControllerStore,
  type ChatWorkspaceDraftThreadRequest,
  type ChatWorkspaceOpenRequest,
} from "../../workspace/chatWorkspaceController";
import {
  resolveWorkspaceInitialRouteDecision,
  resolveWorkspaceRouteSyncDecision,
} from "../../workspace/chatWorkspaceRouteSync";
import {
  createChatWorkspacePanelId,
  getChatWorkspaceRouteTargetKey,
  isChatWorkspacePanelId,
  type ChatWorkspacePanelId,
  type ChatWorkspacePanelState,
  type ChatWorkspacePanelTarget,
  type ChatWorkspaceRouteTarget,
} from "../../workspace/workspacePanelIds";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { NoActiveThreadContent } from "../NoActiveThreadState";
import { SIDEBAR_LABEL_TEXT_CLASS } from "../sidebar/sidebarTextStyles";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarInset, SidebarTrigger, useSidebar } from "../ui/sidebar";
import { ChatWorkspacePanel } from "./ChatWorkspacePanel";

const CHAT_PANEL_COMPONENT_ID = "chatContainer";
const WORKSPACE_PERSIST_DEBOUNCE_MS = 250;
const TOP_RIGHT_HEADER_EDGE_TOLERANCE_PX = 2;
const WORKSPACE_TAB_MIN_WIDTH_PX = 96;
const WORKSPACE_TAB_HORIZONTAL_PADDING_PX = 16;
const WORKSPACE_TAB_ITEM_GAP_PX = 4;
const WORKSPACE_TAB_CONTAINER_GAP_PX = 2;
const WORKSPACE_TAB_SIZING_TOLERANCE_PX = 1;

interface ChatWorkspaceContextValue {
  activePanelId: ChatWorkspacePanelId | null;
  newThreadShortcutLabel: string | null;
  onCreateDraftPanel: (referenceGroupId?: string) => void;
  panelsById: Record<ChatWorkspacePanelId, ChatWorkspacePanelState>;
}

const ChatWorkspaceContext = createContext<ChatWorkspaceContextValue | null>(null);

function useChatWorkspaceContext() {
  const context = useContext(ChatWorkspaceContext);
  if (!context) throw new Error("ChatWorkspace panels must render inside ChatWorkspace.");
  return context;
}

function normalizePanelId(id: string): ChatWorkspacePanelId | null {
  return isChatWorkspacePanelId(id) ? id : null;
}

function fallbackPanelTitle(state: ChatWorkspacePanelState): string {
  if (state.kind === "empty") return "New tab";
  return state.target.kind === "draft" ? "New thread" : "Thread";
}

function samePanelTarget(left: ChatWorkspacePanelTarget, right: ChatWorkspacePanelTarget): boolean {
  return (
    left.kind === right.kind &&
    left.ref.environmentId === right.ref.environmentId &&
    left.ref.threadId === right.ref.threadId &&
    (left.kind !== "draft" || (right.kind === "draft" && left.draftId === right.draftId))
  );
}

function samePanelState(left: ChatWorkspacePanelState, right: ChatWorkspacePanelState): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "empty" || right.kind === "empty") return true;
  return samePanelTarget(left.target, right.target);
}

function removePanelState(
  panelsById: Record<ChatWorkspacePanelId, ChatWorkspacePanelState>,
  panelId: ChatWorkspacePanelId,
) {
  if (!(panelId in panelsById)) return panelsById;
  const next = { ...panelsById };
  delete next[panelId];
  return next;
}

function DockviewWatermark(_props: IWatermarkPanelProps) {
  return <NoActiveThreadContent />;
}

const DOCKVIEW_HEADER_ICON_BUTTON_CLASS =
  "inline-flex size-8! items-center justify-center rounded-full !bg-transparent !text-muted-foreground transition-colors hover:!bg-transparent hover:!text-foreground focus-visible:outline-none focus-visible:!ring-0 focus-visible:ring-offset-0 active:!bg-transparent dark:!text-white/50 dark:hover:!text-white/86 [&_svg]:text-current!";

function DockviewHeaderIconButton(props: {
  "aria-label": string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      aria-label={props["aria-label"]}
      className={cn(DOCKVIEW_HEADER_ICON_BUTTON_CLASS, props.className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={props.title}
      type="button"
    >
      {props.children}
    </button>
  );
}

function getDockviewHeaderElements(actionsElement: HTMLElement | null) {
  const headerElement = actionsElement?.closest(".dv-tabs-and-actions-container");
  const tabsContainer = headerElement?.querySelector(".dv-tabs-container");
  const dockviewElement = actionsElement?.closest(".upcomputer-dockview-theme");
  return {
    dockviewElement: dockviewElement instanceof HTMLElement ? dockviewElement : null,
    headerElement: headerElement instanceof HTMLElement ? headerElement : null,
    tabsContainer: tabsContainer instanceof HTMLElement ? tabsContainer : null,
  };
}

function getWorkspaceTabNaturalWidth(tabElement: HTMLElement): number {
  const titleElement = tabElement.querySelector<HTMLElement>(".upcomputer-workspace-tab-title");
  const closeElement = tabElement.querySelector<HTMLElement>(".upcomputer-workspace-tab-close");
  const closeWidth = closeElement?.offsetWidth ?? 0;
  return Math.max(
    WORKSPACE_TAB_MIN_WIDTH_PX,
    Math.ceil(
      (titleElement?.scrollWidth ?? tabElement.scrollWidth) +
        WORKSPACE_TAB_HORIZONTAL_PADDING_PX +
        (closeWidth > 0 ? closeWidth + WORKSPACE_TAB_ITEM_GAP_PX : 0),
    ),
  );
}

function resolveWorkspaceTabSizing(
  tabsContainer: HTMLElement,
  tabElements: readonly HTMLElement[],
): "fill" | "hug" {
  if (tabElements.length <= 1) return "hug";
  const naturalTabsWidth =
    tabElements.reduce((total, tab) => total + getWorkspaceTabNaturalWidth(tab), 0) +
    Math.max(0, tabElements.length - 1) * WORKSPACE_TAB_CONTAINER_GAP_PX;
  return naturalTabsWidth > tabsContainer.clientWidth + WORKSPACE_TAB_SIZING_TOLERANCE_PX
    ? "fill"
    : "hug";
}

function isTopRightDockviewHeader(actionsElement: HTMLElement | null): boolean {
  const { dockviewElement, headerElement } = getDockviewHeaderElements(actionsElement);
  if (!dockviewElement || !headerElement) return false;
  const dockviewRect = dockviewElement.getBoundingClientRect();
  const headerRect = headerElement.getBoundingClientRect();
  return (
    Math.abs(headerRect.top - dockviewRect.top) <= TOP_RIGHT_HEADER_EDGE_TOLERANCE_PX &&
    Math.abs(headerRect.right - dockviewRect.right) <= TOP_RIGHT_HEADER_EDGE_TOLERANCE_PX
  );
}

function DockviewPrefixHeaderActions(props: IDockviewHeaderActionsProps) {
  const sidebar = useSidebar();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const isPrimaryGroup = props.containerApi.groups[0]?.id === props.group.id;
  if (!isPrimaryGroup) return null;

  const reserveMacTrafficLights =
    isElectron &&
    (sidebar.isMobile || !sidebar.open) &&
    isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform);

  return (
    <div
      className={cn(
        "flex h-full items-center px-2",
        reserveMacTrafficLights && "pl-[90px] wco:pl-[calc(env(titlebar-area-x)+1em)]",
      )}
    >
      <SidebarTrigger
        className={DOCKVIEW_HEADER_ICON_BUTTON_CLASS}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <DockviewHeaderIconButton
        aria-label="Back to previous view"
        onClick={() => {
          if (canGoBack) {
            window.history.back();
            return;
          }
          void navigate({ to: "/" });
        }}
        title="Back"
      >
        <ArrowLeftIcon className="size-4" />
      </DockviewHeaderIconButton>
    </div>
  );
}

function DockviewRightHeaderActions(props: IDockviewHeaderActionsProps) {
  const { newThreadShortcutLabel, onCreateDraftPanel } = useChatWorkspaceContext();
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [reserveWindowControlsInset, setReserveWindowControlsInset] = useState(false);
  const [overflowMenuItems, setOverflowMenuItems] = useState<
    Array<{ id: string; title: string; isActive: boolean }>
  >([]);
  const panelIdsKey = props.panels.map((panel) => panel.id).join("\0");
  const canCloseSplit = props.containerApi.groups.length > 1 && props.group.panels.length === 1;

  const updateOverflowMenuItems = useCallback(() => {
    const { tabsContainer } = getDockviewHeaderElements(actionsRef.current);
    if (!tabsContainer) {
      setOverflowMenuItems([]);
      return;
    }
    const tabElements = Array.from(tabsContainer.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("dv-tab"),
    );
    const tabSizing = resolveWorkspaceTabSizing(tabsContainer, tabElements);
    if (tabsContainer.dataset.tabSizing !== tabSizing) tabsContainer.dataset.tabSizing = tabSizing;

    const containerRect = tabsContainer.getBoundingClientRect();
    const groupPanels = props.group.panels.length > 0 ? props.group.panels : props.panels;
    const nextItems = tabElements.flatMap((tabElement, index) => {
      const panel = groupPanels[index];
      if (!panel) return [];
      const tabRect = tabElement.getBoundingClientRect();
      const hidden =
        tabRect.left < containerRect.left - 1 || tabRect.right > containerRect.right + 1;
      return hidden
        ? [{ id: panel.id, title: panel.title?.trim() || "Thread", isActive: panel.api.isActive }]
        : [];
    });
    setOverflowMenuItems((previous) =>
      previous.length === nextItems.length &&
      previous.every(
        (item, index) =>
          item.id === nextItems[index]?.id &&
          item.title === nextItems[index]?.title &&
          item.isActive === nextItems[index]?.isActive,
      )
        ? previous
        : nextItems,
    );
  }, [props.group, props.panels]);

  useLayoutEffect(() => {
    let animationFrameId: number | null = null;
    const scheduleUpdate = () => {
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        setReserveWindowControlsInset(isTopRightDockviewHeader(actionsRef.current));
        updateOverflowMenuItems();
      });
    };
    scheduleUpdate();
    const { dockviewElement, headerElement, tabsContainer } = getDockviewHeaderElements(
      actionsRef.current,
    );
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    if (dockviewElement) resizeObserver.observe(dockviewElement);
    if (headerElement) resizeObserver.observe(headerElement);
    if (tabsContainer) resizeObserver.observe(tabsContainer);
    const mutationObserver = new MutationObserver(scheduleUpdate);
    if (tabsContainer) {
      mutationObserver.observe(tabsContainer, {
        attributeFilter: ["class", "style"],
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    const disposables = [
      props.containerApi.onDidLayoutChange(scheduleUpdate),
      props.containerApi.onDidActivePanelChange(scheduleUpdate),
      props.containerApi.onDidAddPanel(scheduleUpdate),
      props.containerApi.onDidRemovePanel(scheduleUpdate),
      ...props.panels.flatMap((panel) => [
        panel.api.onDidActiveChange(scheduleUpdate),
        panel.api.onDidTitleChange(scheduleUpdate),
      ]),
    ];
    return () => {
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      for (const disposable of disposables) disposable.dispose();
    };
  }, [panelIdsKey, props.containerApi, props.panels, updateOverflowMenuItems]);

  return (
    <div
      ref={actionsRef}
      className={cn(
        "flex h-full items-center gap-1 px-2",
        reserveWindowControlsInset &&
          "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+8px)]",
      )}
    >
      {overflowMenuItems.length > 0 ? (
        <Menu>
          <MenuTrigger
            render={
              <button
                aria-label="More workspace tabs"
                className={DOCKVIEW_HEADER_ICON_BUTTON_CLASS}
                onPointerDown={(event) => event.stopPropagation()}
                title="More workspace tabs"
                type="button"
              />
            }
          >
            <EllipsisIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-56 max-w-80" side="bottom">
            {overflowMenuItems.map((item) => (
              <MenuItem
                key={item.id}
                className="max-w-72"
                onClick={() =>
                  props.group.panels.find((panel) => panel.id === item.id)?.api.setActive()
                }
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.isActive ? "bg-foreground" : "bg-transparent",
                  )}
                />
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {item.title}
                </span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : null}
      <DockviewHeaderIconButton
        aria-label="New workspace tab"
        onClick={() => onCreateDraftPanel(props.group.id)}
        title={
          newThreadShortcutLabel
            ? `New thread in new tab (${newThreadShortcutLabel})`
            : "New thread in new tab"
        }
      >
        <PlusIcon className="size-4" />
      </DockviewHeaderIconButton>
      {canCloseSplit ? (
        <DockviewHeaderIconButton
          aria-label="Close workspace split"
          onClick={() => props.api.close()}
          title="Close workspace split"
        >
          <XIcon className="size-4" />
        </DockviewHeaderIconButton>
      ) : null}
    </div>
  );
}

function DockviewChatTab(props: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(() => props.api.title ?? "Thread");
  const [active, setActive] = useState(() => props.api.isActive);

  useEffect(() => {
    setTitle(props.api.title ?? "Thread");
    const titleDisposable = props.api.onDidTitleChange((event) => setTitle(event.title));
    const activeDisposable = props.api.onDidActiveChange((event) => setActive(event.isActive));
    return () => {
      titleDisposable.dispose();
      activeDisposable.dispose();
    };
  }, [props.api]);

  return (
    <div
      className={cn(
        "upcomputer-workspace-tab flex w-full items-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0 transition-colors",
        SIDEBAR_LABEL_TEXT_CLASS,
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:text-white/82",
      )}
      title={title}
    >
      <span className="upcomputer-workspace-tab-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {title}
      </span>
      {active ? (
        <button
          aria-label={`Close ${title}`}
          className="upcomputer-workspace-tab-close inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/55 hover:text-sidebar-accent-foreground focus-visible:outline-none"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.api.close();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const DockviewChatPanel = memo(function DockviewChatPanel(
  props: IDockviewPanelProps<{ panelId?: ChatWorkspacePanelId }>,
) {
  const panelId = normalizePanelId(props.params?.panelId ?? props.api.id);
  const { activePanelId, panelsById } = useChatWorkspaceContext();
  const panelState = panelId ? panelsById[panelId] : undefined;
  const threadRef = panelState?.kind === "chat" ? panelState.target.ref : null;
  const thread = useThread(threadRef);

  useEffect(() => {
    props.api.setTitle(
      panelState?.kind === "empty"
        ? "New tab"
        : panelState?.target.kind === "draft"
          ? "New thread"
          : thread?.title?.trim() || "Thread",
    );
  }, [panelState, props.api, thread?.title]);

  return (
    <ChatWorkspacePanel
      panelState={panelState}
      isActive={panelId === activePanelId}
      persistenceKey={panelId ?? undefined}
    />
  );
});

export interface ChatWorkspaceProps {
  routeTarget?: ChatWorkspaceRouteTarget | null;
  children?: ReactNode;
}

export function ChatWorkspace({ children, routeTarget = null }: ChatWorkspaceProps) {
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { activeDraftThread, activeThread, defaultProjectRef } = useHandleNewThread();
  const createDraftThread = useCreateDraftThreadState();
  const apiRef = useRef<DockviewApi | null>(null);
  const panelsRef = useRef<Record<ChatWorkspacePanelId, ChatWorkspacePanelState>>({});
  const activePanelRef = useRef<ChatWorkspacePanelId | null>(null);
  const restoredRef = useRef(false);
  const applyingRouteRef = useRef(false);
  const lastRouteKeyRef = useRef<string | null>(null);
  const pendingOutboundRouteKeyRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const [api, setApi] = useState<DockviewApi | null>(null);
  const [panelsById, setPanelsById] = useState<
    Record<ChatWorkspacePanelId, ChatWorkspacePanelState>
  >({});
  const [activePanelId, setActivePanelId] = useState<ChatWorkspacePanelId | null>(null);
  const registerController = useChatWorkspaceControllerStore((state) => state.registerController);
  const setControllerActivePanel = useChatWorkspaceControllerStore(
    (state) => state.setActivePanelId,
  );
  const newThreadShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "chat.new"),
    [keybindings],
  );

  const commitPanels = useCallback(
    (next: Record<ChatWorkspacePanelId, ChatWorkspacePanelState>) => {
      panelsRef.current = next;
      setPanelsById(next);
    },
    [],
  );

  const commitActivePanel = useCallback(
    (next: ChatWorkspacePanelId | null) => {
      if (activePanelRef.current === next) {
        return;
      }
      activePanelRef.current = next;
      setActivePanelId(next);
      setControllerActivePanel(next);
    },
    [setControllerActivePanel],
  );

  const persistNow = useCallback(() => {
    if (!restoredRef.current) return;
    writePersistedChatWorkspaceState({
      version: 1,
      dockview: apiRef.current?.toJSON() ?? null,
      panelsById: panelsRef.current,
      activePanelId: activePanelRef.current,
    });
  }, []);

  const schedulePersist = useCallback(() => {
    if (!restoredRef.current) return;
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      persistNow();
    }, WORKSPACE_PERSIST_DEBOUNCE_MS);
  }, [persistNow]);

  const ensurePanel = useCallback(
    (
      dockviewApi: DockviewApi,
      panelId: ChatWorkspacePanelId,
      state: ChatWorkspacePanelState,
      referenceGroupId?: string,
    ) => {
      const existing = dockviewApi.getPanel(panelId);
      if (existing) {
        // Hidden zero-sized containers corrupt LegendList's virtual viewport.
        // Let Dockview unmount inactive panels; ChatView restores their semantic
        // row anchor when they become visible again.
        if (existing.api.renderer !== "onlyWhenVisible") {
          existing.api.setRenderer("onlyWhenVisible");
        }
        return existing;
      }
      const options = {
        id: panelId,
        component: CHAT_PANEL_COMPONENT_ID,
        title: fallbackPanelTitle(state),
        params: { panelId },
        renderer: "onlyWhenVisible" as const,
      };
      return referenceGroupId && dockviewApi.getGroup(referenceGroupId)
        ? dockviewApi.addPanel({
            ...options,
            position: { referenceGroup: referenceGroupId, direction: "within" as const },
          })
        : dockviewApi.addPanel(options);
    },
    [],
  );

  const setPanelState = useCallback(
    (panelId: ChatWorkspacePanelId, state: ChatWorkspacePanelState, referenceGroupId?: string) => {
      const dockviewApi = apiRef.current;
      if (!dockviewApi) return false;
      const previous = panelsRef.current[panelId];
      if (!previous || !samePanelState(previous, state)) {
        commitPanels({ ...panelsRef.current, [panelId]: state });
      }
      const panel = ensurePanel(dockviewApi, panelId, state, referenceGroupId);
      panel.api.setActive();
      commitActivePanel(panelId);
      return true;
    },
    [commitActivePanel, commitPanels, ensurePanel],
  );

  const openWorkspaceTarget = useCallback(
    (request: ChatWorkspaceOpenRequest): ChatWorkspacePanelId | null => {
      const dockviewApi = apiRef.current;
      if (!dockviewApi) return null;
      const panelId = resolveWorkspacePanelIdForOpenRequest({
        activePanelId: activePanelRef.current,
        createPanelId: createChatWorkspacePanelId,
        hasPanel: (candidate) => dockviewApi.getPanel(candidate) !== undefined,
        request,
      });
      const state: ChatWorkspacePanelState =
        request.target.kind === "empty"
          ? { kind: "empty" }
          : {
              kind: "chat",
              target:
                request.target.kind === "thread"
                  ? { kind: "thread", ref: request.target.ref }
                  : {
                      kind: "draft",
                      draftId: request.target.draftId,
                      ref: request.target.ref,
                    },
            };
      return setPanelState(panelId, state, request.referenceGroupId) ? panelId : null;
    },
    [setPanelState],
  );

  const beginOutboundRouteSync = useCallback((routeKey: string) => {
    pendingOutboundRouteKeyRef.current = routeKey;
    lastRouteKeyRef.current = routeKey;
  }, []);
  const clearPendingOutboundRouteSync = useCallback((routeKey: string) => {
    if (pendingOutboundRouteKeyRef.current === routeKey) {
      pendingOutboundRouteKeyRef.current = null;
    }
  }, []);

  const createDraftThreadPanel = useCallback(
    (request: ChatWorkspaceDraftThreadRequest) => {
      const options: NewThreadOptions = {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode:
          request.options?.envMode ??
          activeDraftThread?.envMode ??
          (activeThread?.worktreePath ? "worktree" : "local"),
        ...request.options,
        forceNewDraft: true,
      };
      const created = createDraftThread(request.projectRef, options);
      const panelId = openWorkspaceTarget({
        disposition: request.disposition,
        ...(request.referenceGroupId ? { referenceGroupId: request.referenceGroupId } : {}),
        target: { kind: "draft", draftId: created.draftId, ref: created.ref },
      });
      if (!panelId) {
        useComposerDraftStore.getState().clearDraftThread(created.draftId);
        return null;
      }
      const routeKey = getChatWorkspaceRouteTargetKey({
        target: { kind: "draft", draftId: created.draftId, ref: created.ref },
      });
      beginOutboundRouteSync(routeKey);
      void navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(created.draftId),
      }).catch(() => {
        clearPendingOutboundRouteSync(routeKey);
      });
      persistNow();
      return created;
    },
    [
      activeDraftThread,
      activeThread,
      beginOutboundRouteSync,
      clearPendingOutboundRouteSync,
      createDraftThread,
      navigate,
      openWorkspaceTarget,
      persistNow,
    ],
  );

  const createDraftPanel = useCallback(
    (referenceGroupId?: string) => {
      const projectRef = resolveThreadActionProjectRef({
        activeDraftThread,
        activeThread: activeThread ?? undefined,
        defaultProjectRef,
        handleNewThread: async () => {},
      });
      if (!projectRef) return;
      createDraftThreadPanel({
        projectRef,
        disposition: "new-panel",
        ...(referenceGroupId ? { referenceGroupId } : {}),
      });
    },
    [activeDraftThread, activeThread, createDraftThreadPanel, defaultProjectRef],
  );

  useEffect(
    () => registerController({ createDraftThreadPanel, openWorkspaceTarget }),
    [createDraftThreadPanel, openWorkspaceTarget, registerController],
  );

  const syncRouteToPanel = useCallback(
    (panelId: ChatWorkspacePanelId | null) => {
      if (!restoredRef.current || applyingRouteRef.current) return;
      const state = panelId ? panelsRef.current[panelId] : null;
      if (!state || state.kind === "empty") {
        const routeKey = "index";
        beginOutboundRouteSync(routeKey);
        void navigate({ to: "/", replace: true }).then(
          () => {
            clearPendingOutboundRouteSync(routeKey);
          },
          () => {
            clearPendingOutboundRouteSync(routeKey);
          },
        );
        return;
      }
      const routeKey = getChatWorkspaceRouteTargetKey({ target: state.target });
      beginOutboundRouteSync(routeKey);
      if (state.target.kind === "draft") {
        void navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(state.target.draftId),
          replace: true,
        }).catch(() => {
          clearPendingOutboundRouteSync(routeKey);
        });
      } else {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(state.target.ref),
          replace: true,
        }).catch(() => {
          clearPendingOutboundRouteSync(routeKey);
        });
      }
    },
    [beginOutboundRouteSync, clearPendingOutboundRouteSync, navigate],
  );

  const applyRouteTarget = useCallback(
    (target: ChatWorkspaceRouteTarget) => {
      applyingRouteRef.current = true;
      const panelId = openWorkspaceTarget({
        disposition: "active-panel",
        target:
          target.target.kind === "thread"
            ? { kind: "thread", ref: target.target.ref }
            : { kind: "draft", draftId: target.target.draftId, ref: target.target.ref },
      });
      lastRouteKeyRef.current = getChatWorkspaceRouteTargetKey(target);
      queueMicrotask(() => {
        applyingRouteRef.current = false;
      });
      return panelId;
    },
    [openWorkspaceTarget],
  );

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const dockviewApi = event.api;
      apiRef.current = dockviewApi;
      setApi(dockviewApi);
      const persisted = readPersistedChatWorkspaceState();
      let restored: PersistedChatWorkspaceStateV1 = persisted;

      if (persisted.dockview) {
        try {
          dockviewApi.fromJSON(persisted.dockview as SerializedDockview);
        } catch {
          dockviewApi.clear();
          restored = EMPTY_CHAT_WORKSPACE_STATE;
        }
      }

      for (const panel of dockviewApi.panels.slice()) {
        const panelId = normalizePanelId(panel.id);
        if (!panelId || !(panelId in restored.panelsById)) dockviewApi.removePanel(panel);
      }
      for (const [panelId, state] of Object.entries(restored.panelsById) as Array<
        [ChatWorkspacePanelId, ChatWorkspacePanelState]
      >) {
        ensurePanel(dockviewApi, panelId, state);
      }

      commitPanels(restored.panelsById);
      const restoredActive =
        restored.activePanelId && dockviewApi.getPanel(restored.activePanelId)
          ? restored.activePanelId
          : normalizePanelId(dockviewApi.activePanel?.id ?? "");
      if (restoredActive) dockviewApi.getPanel(restoredActive)?.api.setActive();
      commitActivePanel(restoredActive);
      restoredRef.current = true;

      const initialRouteDecision = resolveWorkspaceInitialRouteDecision({
        hasRouteTarget: routeTarget !== null,
        hasRestoredPanels: Object.keys(restored.panelsById).length > 0,
      });
      if (initialRouteDecision === "apply-route" && routeTarget) {
        applyRouteTarget(routeTarget);
      } else if (initialRouteDecision === "restore-active-panel") {
        syncRouteToPanel(restoredActive);
      }
      schedulePersist();
    },
    [
      applyRouteTarget,
      commitActivePanel,
      commitPanels,
      ensurePanel,
      routeTarget,
      schedulePersist,
      syncRouteToPanel,
    ],
  );

  useEffect(() => {
    if (!api) return;
    const activeDisposable = api.onDidActivePanelChange((panel) => {
      const panelId = normalizePanelId(panel?.id ?? "");
      commitActivePanel(panelId);
      syncRouteToPanel(panelId);
      schedulePersist();
    });
    const removeDisposable = api.onDidRemovePanel((panel) => {
      const panelId = normalizePanelId(panel.id);
      if (!panelId) return;
      commitPanels(removePanelState(panelsRef.current, panelId));
      const nextActive = normalizePanelId(api.activePanel?.id ?? "");
      commitActivePanel(nextActive);
      syncRouteToPanel(nextActive);
      schedulePersist();
    });
    const layoutDisposable = api.onDidLayoutChange(schedulePersist);
    return () => {
      activeDisposable.dispose();
      removeDisposable.dispose();
      layoutDisposable.dispose();
    };
  }, [api, commitActivePanel, commitPanels, schedulePersist, syncRouteToPanel]);

  useEffect(() => {
    if (!api || !routeTarget || !restoredRef.current) return;
    const key = getChatWorkspaceRouteTargetKey(routeTarget);
    const decision = resolveWorkspaceRouteSyncDecision({
      incomingRouteKey: key,
      lastRouteKey: lastRouteKeyRef.current,
      pendingOutboundRouteKey: pendingOutboundRouteKeyRef.current,
    });
    if (decision === "acknowledge-pending") {
      pendingOutboundRouteKeyRef.current = null;
      lastRouteKeyRef.current = key;
      return;
    }
    if (decision !== "apply-route") {
      return;
    }
    applyRouteTarget(routeTarget);
    schedulePersist();
  }, [api, applyRouteTarget, routeTarget, schedulePersist]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      persistNow();
    };
  }, [persistNow]);

  const contextValue = useMemo<ChatWorkspaceContextValue>(
    () => ({
      activePanelId,
      newThreadShortcutLabel,
      onCreateDraftPanel: createDraftPanel,
      panelsById,
    }),
    [activePanelId, createDraftPanel, newThreadShortcutLabel, panelsById],
  );

  return (
    <ChatWorkspaceContext.Provider value={contextValue}>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none text-foreground md:h-dvh">
        <DockviewReact
          className="upcomputer-dockview-theme h-full w-full"
          components={{ [CHAT_PANEL_COMPONENT_ID]: DockviewChatPanel }}
          defaultRenderer="onlyWhenVisible"
          defaultTabComponent={DockviewChatTab}
          disableFloatingGroups
          disableTabsOverflowList
          getTabContextMenuItems={() => ["close", "closeOthers", "closeAll"]}
          onReady={onReady}
          onWillDrop={(event) => {
            const data = event.getData();
            if (data && data.viewId !== event.api.id) event.preventDefault();
          }}
          prefixHeaderActionsComponent={DockviewPrefixHeaderActions}
          rightHeaderActionsComponent={DockviewRightHeaderActions}
          watermarkComponent={DockviewWatermark}
        />
        {children}
      </SidebarInset>
    </ChatWorkspaceContext.Provider>
  );
}

export type { ChatWorkspaceRouteTarget } from "../../workspace/workspacePanelIds";
