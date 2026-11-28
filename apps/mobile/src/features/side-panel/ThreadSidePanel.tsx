import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { NavigationContext } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import type { MenuAction } from "@react-native-menu/menu";
import { use, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { UpIcon } from "../../components/up-icons/UpIcon";
import { upSymbol } from "../../components/up-icons/upSymbol";
import { ListRow } from "../../components/ui/ListRow";
import { GlassCapsule } from "./GlassBarButton";
import { Menu } from "../../components/ui/Menu";
import { useSideChats } from "../../state/entities";
import { BrowserPreviewScreen } from "../browser/BrowserPreviewRouteScreen";
import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";
import { InspectorCloseContext } from "../layout/inspector-bar-store";
import { InspectorPanes } from "../layout/inspector-host";
import { InspectorSheetContext } from "../layout/workspace-inspector-sheet";
import { SelectsDetailOverPageContext } from "../layout/workspace/useSelectWorkspaceDetail";
import { ReviewSheet } from "../review/ReviewSheet";
import { TasksScreen } from "../tasks/TasksScreen";
import { ThreadTerminalRouteScreen } from "../terminal/ThreadTerminalRouteScreen";
import { ThreadMergeBackContext } from "../threads/ThreadGitControls";
import { ThreadPullRequestsSheet } from "../threads/ThreadPullRequestsSheet";
import { InspectorSheetSizeContext } from "./inspectorSheetSize";
import { createSidePanelBarStore, SidePanelBarSlot, SidePanelHeaderRow } from "./sidePanelBar";
import { sidePanelNavigation } from "./sidePanelNavigation";
import { useSidePanelEntries, type SurfaceEntry } from "./useSidePanelEntries";
import {
  closeSidePanelTab,
  openSidePanelSurface,
  setSidePanelTerminal,
  updateSidePanel,
  useSidePanel,
  type SidePanelSurface,
  type SidePanelTab,
} from "./sidePanelState";

/**
 * The desktop's right panel beside a chat: one header row whose select switches between the open
 * views, each one of the phone's screens, opens and closes views, and shows the current view's
 * actions; with no view open it lists the views the desktop offers for this chat, minus Device.
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
  /** A page opened from the panel closed its sheet; Back to the chat should bring the sheet back. */
  readonly onLeaveSheet?: () => void;
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
  const leave = (then: () => void) => {
    if (!closeSheet) return then();
    props.onLeaveSheet?.();
    closeSheet(then);
  };
  const update = (change: Parameters<typeof updateSidePanel>[1]) =>
    updateSidePanel(threadKey, change);

  const { entries, openPullRequest } = useSidePanelEntries({
    thread,
    cwd: props.cwd,
    canOpenTerminal: props.canOpenTerminal,
    isRepo: props.isRepo,
  });
  const entryOf = (surface: SidePanelSurface) => entries.find((entry) => entry.surface === surface);

  const open = (surface: SurfaceEntry["surface"]) => {
    if (surface === "pullRequest") {
      leave(openPullRequest);
      return;
    }
    update((state) => openSidePanelSurface(state, surface));
  };
  // Closing the last view closes the panel too: an empty panel only repeats the bar's menu.
  const closeTab = (id: SidePanelSurface) => {
    const last = panel.tabs.length === 1 && panel.tabs[0]?.id === id;
    update((state) => closeSidePanelTab(state, id));
    if (last) closePanel?.();
  };

  const [barStore] = useState(createSidePanelBarStore);
  const current = panel.tabs.find((tab) => tab.id === panel.active) ?? null;
  const currentEntry = current ? entryOf(current.id) : undefined;

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
        {/* A row's page opens over the chat through `scoped`, not in place of it. */}
        <SelectsDetailOverPageContext value>
          {/* The header row closes the panel, so a screen's bar keeps no close button of its own. */}
          <InspectorCloseContext value={null}>
            <SidePanelBarSlot store={barStore} viewKey={tab.id}>
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
            </SidePanelBarSlot>
          </InspectorCloseContext>
        </SelectsDetailOverPageContext>
      </NavigationContext.Provider>
    );
  };

  const openActions: MenuAction[] = entries.map((entry) => ({
    id: `open:${entry.surface}`,
    title: entry.label,
    image: entry.symbol,
    ...(entry.available ? {} : { subtitle: entry.hint, attributes: { disabled: true } }),
  }));
  const selectActions: MenuAction[] =
    panel.tabs.length === 0
      ? openActions
      : [
          {
            id: "views",
            title: "",
            displayInline: true,
            subactions: panel.tabs.map((tab) => {
              const entry = entryOf(tab.id);
              return {
                id: `show:${tab.id}`,
                title: entry?.label ?? tab.id,
                image: entry?.symbol,
                state: tab.id === current?.id ? ("on" as const) : ("off" as const),
              };
            }),
          },
          {
            id: "manage",
            title: "",
            displayInline: true,
            subactions: [
              { id: "open", title: gt("Open view"), image: "plus", subactions: openActions },
              ...(current ? [{ id: "close", title: gt("Close view"), image: "xmark" }] : []),
            ],
          },
        ];
  const onSelect = (id: string) => {
    if (id === "close") {
      if (current) closeTab(current.id);
      return;
    }
    const [kind, surface] = id.split(":") as [string, SurfaceEntry["surface"] | undefined];
    if (surface === undefined) return;
    if (kind === "open") open(surface);
    else if (kind === "show" && surface !== "pullRequest")
      update((state) => ({ ...state, active: surface }));
  };
  const selectTitle = currentEntry?.label ?? current?.id ?? gt("Open view");

  return (
    <View className="flex-1 bg-sheet">
      <SidePanelHeaderRow
        store={barStore}
        viewKey={current?.id ?? null}
        style={{ paddingTop: size ? 14 : insets.top + 8 }}
        leading={
          <Menu
            accessible
            accessibilityRole="button"
            accessibilityLabel={gt("View: {title}", { title: selectTitle })}
            actions={selectActions}
            onPressAction={({ nativeEvent }) => onSelect(nativeEvent.event)}
            style={{ flexShrink: 1 }}
          >
            <GlassCapsule wide>
              <UpIcon
                name={currentEntry?.icon ?? "plus"}
                size={18}
                tintColorClassName="accent-icon"
              />
              <Text numberOfLines={1} className="shrink text-[17px] font-t3-medium text-foreground">
                {selectTitle}
              </Text>
              <UpIcon name="chevron-down" size={14} tintColorClassName="accent-icon-muted" />
            </GlassCapsule>
          </Menu>
        }
        trailing={
          closePanel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Close")}
              onPress={closePanel}
              hitSlop={4}
              className="active:opacity-60"
            >
              <GlassCapsule>
                <UpIcon name="close" size={18} tintColorClassName="accent-icon" />
              </GlassCapsule>
            </Pressable>
          ) : null
        }
      />
      <View className="flex-1">
        <InspectorPanes
          content={{
            active: current?.id ?? "new",
            resetKeys: [threadKey, props.cwd],
            panes: [
              ...(current
                ? []
                : [
                    {
                      key: "new",
                      render: () => <SurfaceLauncher entries={entries} onOpen={open} />,
                    },
                  ]),
              ...panel.tabs.map((tab) => ({ key: tab.id, render: () => renderTab(tab) })),
            ],
          }}
          onClose={() => closePanel?.()}
        />
      </View>
    </View>
  );
}

/** No view open yet: the views to open, each its own card. Views the chat can't show are dimmed. */
function SurfaceLauncher(props: {
  readonly entries: ReadonlyArray<SurfaceEntry>;
  readonly onOpen: (surface: SurfaceEntry["surface"]) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerClassName="gap-2 px-5 pt-5"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      {props.entries.map((entry) => (
        <View key={entry.surface} className="overflow-hidden rounded-2xl border-continuous">
          <ListRow
            icon={upSymbol(entry.icon)}
            label={entry.label}
            description={entry.available ? undefined : entry.hint}
            disabled={!entry.available}
            onPress={() => props.onOpen(entry.surface)}
          />
        </View>
      ))}
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
      return <TasksScreen />;
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
