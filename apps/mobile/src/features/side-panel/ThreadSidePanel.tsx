import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { NavigationContext } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { use, useRef, type ReactNode } from "react";
import { Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { cn } from "../../lib/cn";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useSideChats } from "../../state/entities";
import { useThreadServerBrowserTabs } from "../../state/preview";
import { resolveThreadPrBadgeAction } from "../../state/thread-pr-presentation";
import { useThreadPr } from "../../state/use-thread-pr";
import { useThreadSelection } from "../../state/use-thread-selection";
import { WorkspaceSlotOptionsContext } from "../../native/v5-workspace-context";
import { BrowserPreviewScreen } from "../browser/BrowserPreviewRouteScreen";
import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";
import { InspectorCloseContext } from "../layout/inspector-bar-store";
import { InspectorPanes } from "../layout/inspector-host";
import { InspectorSheetContext } from "../layout/workspace-inspector-sheet";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { ReviewSheet } from "../review/ReviewSheet";
import { renderTasksHeaderTitle } from "../tasks/TasksHeader";
import { TasksScreen } from "../tasks/TasksScreen";
import { ThreadTerminalRouteScreen } from "../terminal/ThreadTerminalRouteScreen";
import { useLinkedPullRequestLines } from "../threads/LinkedPullRequestList";
import { ThreadMergeBackContext } from "../threads/ThreadGitControls";
import { ThreadPullRequestsSheet } from "../threads/ThreadPullRequestsSheet";
import { useOpenThreadPullRequests } from "../threads/use-open-thread-pull-requests";
import { InspectorSheetSizeContext } from "./inspectorSheetSize";
import { sidePanelNavigation } from "./sidePanelNavigation";
import {
  closeSidePanelTab,
  openSidePanelSurface,
  setSidePanelTerminal,
  updateSidePanel,
  useSidePanel,
  type SidePanelSurface,
  type SidePanelTab,
} from "./sidePanelState";

const TASKS_ICON: AppSymbolName = { ios: "checklist", android: "check" };

interface SurfaceEntry {
  readonly surface: SidePanelSurface | "pullRequest";
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly available: boolean;
  readonly hint?: string;
}

/**
 * The desktop's right panel beside a chat: a row of tabs, each showing one of the phone's
 * screens, and a new tab that lists the views the desktop offers for this chat, minus Device.
 * A sheet on the phone, the inspector column on the iPad.
 */
export function ThreadSidePanel(props: {
  readonly thread: EnvironmentThreadShell;
  readonly cwd: string | null;
  readonly projectTitle: string;
  readonly canOpenTerminal: boolean;
  readonly isRepo: boolean;
  readonly onMergeBack?: () => void;
  readonly onSelectFile: (path: string) => void;
  readonly renderSideChat: (threadId: string) => ReactNode;
}) {
  const gt = useGT();
  const { thread } = props;
  const threadKey = `${thread.environmentId}:${thread.id}`;
  const panel = useSidePanel(threadKey);
  // The chat route's, which the inspector hands its panes.
  const navigation = use(NavigationContext);
  const closePanel = use(InspectorCloseContext);
  const closeSheet = use(InspectorSheetContext);
  const size = use(InspectorSheetSizeContext);
  const insets = useSafeAreaInsets();
  const { selectedEnvironmentRuntime } = useThreadSelection();
  const browserTabs = useThreadServerBrowserTabs({
    environmentId: thread.environmentId,
    threadId: thread.id,
    enabled: true,
  });
  const linkedLines = useLinkedPullRequestLines(thread, selectedEnvironmentRuntime);
  const sideChats = useSideChats({ environmentId: thread.environmentId, threadId: thread.id });
  const pr = useThreadPr(thread);
  const openThreadPullRequests = useOpenThreadPullRequests();
  const leave = (then: () => void) => (closeSheet ? closeSheet(then) : then());
  const update = (change: Parameters<typeof updateSidePanel>[1]) =>
    updateSidePanel(threadKey, change);

  const projectHint = gt("Available when a project is open.");
  const entries: ReadonlyArray<SurfaceEntry> = [
    {
      surface: "browser",
      label: gt("Browser"),
      icon: "globe",
      available: browserTabs.tabs.length > 0,
      hint: gt("Available when this thread has a browser tab."),
    },
    {
      surface: "terminal",
      label: gt("Terminal"),
      icon: "terminal",
      available: props.canOpenTerminal,
      hint: projectHint,
    },
    {
      surface: "files",
      label: gt("Files"),
      icon: "doc.on.doc",
      available: props.cwd !== null,
      hint: projectHint,
    },
    {
      surface: "diff",
      label: gt("Diff"),
      icon: "file.diff",
      available: props.cwd !== null && props.isRepo,
      hint: gt("Available for Git repositories."),
    },
    // The desktop offers these only for a chat that has them.
    ...(pr !== null && resolveThreadPrBadgeAction(pr).kind !== "list"
      ? [
          {
            surface: "pullRequest" as const,
            label: gt("Pull request"),
            icon: PullRequestGlyph.pullRequest,
            available: true,
          },
        ]
      : []),
    ...(linkedLines.length > 0
      ? [
          {
            surface: "linkedItems" as const,
            label: gt("Linked items"),
            icon: "link" as const,
            available: true,
          },
        ]
      : []),
    ...(sideChats.length > 0
      ? [
          {
            surface: "sideChat" as const,
            label: gt("Side chat"),
            icon: "bubble.left.and.bubble.right" as const,
            available: true,
          },
        ]
      : []),
    { surface: "tasks", label: gt("Tasks"), icon: TASKS_ICON, available: true },
  ];
  const entryOf = (surface: SidePanelSurface) => entries.find((entry) => entry.surface === surface);

  const open = (surface: SurfaceEntry["surface"]) => {
    if (surface === "pullRequest") {
      if (pr !== null) leave(() => openThreadPullRequests(thread, pr));
      return;
    }
    update((state) => openSidePanelSurface(state, surface));
  };
  const closeTab = (id: SidePanelSurface) => update((state) => closeSidePanelTab(state, id));

  const renderTab = (tab: SidePanelTab) => {
    const scoped =
      navigation &&
      sidePanelNavigation(navigation, {
        close: () => closeTab(tab.id),
        leave,
        replace: (name, params) => {
          if (tab.id !== "terminal" || name !== "ThreadTerminal") return false;
          const terminalId = (params as { readonly terminalId?: string } | undefined)?.terminalId;
          if (terminalId) update((state) => setSidePanelTerminal(state, terminalId));
          return true;
        },
      });
    return (
      <NavigationContext.Provider value={scoped}>
        {/* The tab row closes the panel, so a screen's bar keeps no close button of its own. */}
        <InspectorCloseContext value={null}>
          <TabBarOptions>
            <SurfaceScreen
              tab={tab}
              thread={thread}
              cwd={props.cwd}
              projectTitle={props.projectTitle}
              onMergeBack={props.onMergeBack}
              onSelectFile={(path) => leave(() => props.onSelectFile(path))}
              onClose={() => closeTab(tab.id)}
              renderSideChat={props.renderSideChat}
            />
          </TabBarOptions>
        </InspectorCloseContext>
      </NavigationContext.Provider>
    );
  };

  const newTab = panel.active === null;
  const tabRow = useRef<ScrollViewInstance>(null);
  const toolbarButton = (button: {
    readonly icon: AppSymbolName;
    readonly label: string;
    readonly onPress: () => void;
  }) => (
    <Pressable
      key={button.label}
      accessibilityRole="button"
      accessibilityLabel={button.label}
      onPress={button.onPress}
      hitSlop={4}
      className="size-10 items-center justify-center rounded-full active:opacity-60"
    >
      <SymbolView name={button.icon} size={18} weight="medium" tintColorClassName="accent-icon" />
    </Pressable>
  );

  return (
    <View className="flex-1 bg-sheet">
      <View
        className="flex-row items-center gap-1 border-b border-border pb-2 pl-3 pr-2"
        style={{ paddingTop: size ? 18 : insets.top + 8 }}
      >
        <ScrollView
          ref={tabRow}
          // A tab just added, or the new tab, sits at the end; keep it in view.
          onContentSizeChange={() => {
            if (newTab || panel.active === panel.tabs.at(-1)?.id) tabRow.current?.scrollToEnd();
          }}
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={gt("Scroll panel tabs")}
          className="flex-1"
          contentContainerClassName="items-center gap-1.5 pr-1"
        >
          {panel.tabs.map((tab) => {
            const entry = entryOf(tab.id);
            const title = entry?.label ?? tab.id;
            const active = panel.active === tab.id;
            return (
              <View
                key={tab.id}
                className={cn(
                  "h-10 flex-row items-center rounded-full pl-3 pr-1",
                  active ? "bg-subtle" : undefined,
                )}
              >
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={title}
                  onPress={() => update((state) => ({ ...state, active: tab.id }))}
                  className="flex-row items-center gap-1.5 active:opacity-60"
                >
                  {entry ? (
                    <SymbolView
                      name={entry.icon}
                      size={15}
                      tintColorClassName={active ? "accent-icon" : "accent-icon-muted"}
                    />
                  ) : null}
                  <Text
                    numberOfLines={1}
                    className={cn(
                      "text-[15px] font-t3-medium",
                      active ? "text-foreground" : "text-foreground-muted",
                    )}
                  >
                    {title}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={gt("Close {title}", { title })}
                  onPress={() => closeTab(tab.id)}
                  hitSlop={6}
                  className="size-8 items-center justify-center active:opacity-60"
                >
                  <SymbolView
                    name="xmark"
                    size={11}
                    weight="semibold"
                    tintColorClassName="accent-icon-muted"
                  />
                </Pressable>
              </View>
            );
          })}
          {newTab ? (
            <View className="h-10 flex-row items-center gap-1.5 rounded-full bg-subtle px-3">
              <SymbolView name="plus" size={14} weight="medium" tintColorClassName="accent-icon" />
              <Text className="text-[15px] font-t3-medium text-foreground">{gt("New tab")}</Text>
            </View>
          ) : null}
        </ScrollView>
        {newTab
          ? null
          : toolbarButton({
              icon: "plus",
              label: gt("Add panel surface"),
              onPress: () => update((state) => ({ ...state, active: null })),
            })}
        {size
          ? toolbarButton({
              icon: size.expanded
                ? "arrow.down.right.and.arrow.up.left"
                : "arrow.up.left.and.arrow.down.right",
              label: size.expanded ? gt("Restore panel size") : gt("Maximize panel"),
              onPress: size.toggle,
            })
          : null}
        {closePanel
          ? toolbarButton({
              icon: "sidebar.right",
              label: gt("Toggle right panel"),
              onPress: closePanel,
            })
          : null}
      </View>
      <View className="flex-1">
        <InspectorPanes
          content={{
            active: panel.active ?? "new",
            resetKeys: [threadKey, props.cwd],
            panes: [
              ...(newTab
                ? [
                    {
                      key: "new",
                      render: () => <SurfaceLauncher entries={entries} onOpen={open} />,
                    },
                  ]
                : []),
              ...panel.tabs.map((tab) => ({ key: tab.id, render: () => renderTab(tab) })),
            ],
          }}
          onClose={() => closePanel?.()}
        />
      </View>
    </View>
  );
}

/**
 * A tab's screen shows its own bar inside the tab. The tabs share one native stack, so UIKit
 * would offer Back to the tab beneath; the tab row is the way between tabs.
 */
function TabBarOptions(props: { readonly children: ReactNode }) {
  const slot = use(WorkspaceSlotOptionsContext);
  if (slot === null) return props.children;
  return (
    <WorkspaceSlotOptionsContext
      value={{
        byRoute: slot.byRoute,
        set: (routeKey, options) => slot.set(routeKey, { ...options, headerBackVisible: false }),
      }}
    >
      {props.children}
    </WorkspaceSlotOptionsContext>
  );
}

/** The new tab: "Open a surface", as on the desktop. Views the chat can't show yet are dimmed. */
function SurfaceLauncher(props: {
  readonly entries: ReadonlyArray<SurfaceEntry>;
  readonly onOpen: (surface: SurfaceEntry["surface"]) => void;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerClassName="px-5 pt-5"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <ListSection title={gt("Open a surface")}>
        {props.entries.map((entry) => (
          <ListRow
            key={entry.surface}
            icon={entry.icon}
            label={entry.label}
            description={entry.available ? undefined : entry.hint}
            disabled={!entry.available}
            onPress={() => props.onOpen(entry.surface)}
          />
        ))}
      </ListSection>
    </ScrollView>
  );
}

function SurfaceScreen(props: {
  readonly tab: SidePanelTab;
  readonly thread: EnvironmentThreadShell;
  readonly cwd: string | null;
  readonly projectTitle: string;
  readonly onMergeBack?: () => void;
  readonly onSelectFile: (path: string) => void;
  readonly onClose: () => void;
  readonly renderSideChat: (threadId: string) => ReactNode;
}) {
  const { thread } = props;
  const sideChats = useSideChats({ environmentId: thread.environmentId, threadId: thread.id });
  const routeParams = { environmentId: String(thread.environmentId), threadId: String(thread.id) };
  switch (props.tab.id) {
    case "files":
      return props.cwd === null ? null : (
        <ThreadFileNavigatorPane
          cwd={props.cwd}
          environmentId={thread.environmentId}
          projectName={props.projectTitle}
          selectedPath={null}
          onSelectFile={props.onSelectFile}
        />
      );
    case "diff":
      return (
        <ThreadMergeBackContext value={props.onMergeBack}>
          <ReviewSheet
            route={{ params: { environmentId: thread.environmentId, threadId: thread.id } }}
          />
        </ThreadMergeBackContext>
      );
    case "terminal":
      return (
        <ThreadTerminalRouteScreen
          route={{
            params: {
              ...routeParams,
              ...(props.tab.terminalId ? { terminalId: props.tab.terminalId } : {}),
            },
          }}
        />
      );
    case "browser":
      return (
        <BrowserPreviewScreen
          environmentId={thread.environmentId}
          threadId={thread.id}
          initialTabId={null}
          onClose={props.onClose}
        />
      );
    case "tasks":
      return (
        <>
          <NativeStackScreenOptions
            options={{ headerShown: true, headerTitle: renderTasksHeaderTitle }}
          />
          <TasksScreen />
        </>
      );
    case "linkedItems":
      return <ThreadPullRequestsSheet route={{ params: routeParams }} />;
    case "sideChat": {
      // The newest side chat, as the desktop's tab opens the one just started.
      const sideChat = sideChats.reduce<(typeof sideChats)[number] | null>(
        (newest, candidate) =>
          newest === null || candidate.createdAt > newest.createdAt ? candidate : newest,
        null,
      );
      return sideChat ? props.renderSideChat(String(sideChat.id)) : null;
    }
  }
}
