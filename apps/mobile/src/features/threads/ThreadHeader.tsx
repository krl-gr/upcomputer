import { useGT, useMessages } from "gt-react-native";
import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu, AppBarTitlePill } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import { openSidePanelSurface, updateSidePanel, useSidePanel } from "../side-panel/sidePanelState";
import {
  useSidePanelEntries,
  type SidePanelEntriesInput,
  type SurfaceEntry,
} from "../side-panel/useSidePanelEntries";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

type ThreadHeaderProps = {
  readonly title: string;
  /** A bot chat's character and name, drawn in place of the title and subtitle. */
  readonly bot?: AppBarTitlePill;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
  /** A chat's bar has one button, the desktop's side panel, in place of files, git and terminal. */
  readonly onOpenSidePanel?: () => void;
  /** The chat's side panel views: with none open, the panel button is their menu. */
  readonly sidePanel?: SidePanelEntriesInput;
};

export function ThreadHeader(props: ThreadHeaderProps) {
  return props.sidePanel && props.onOpenSidePanel ? (
    <ThreadHeaderWithPanelMenu {...props} sidePanel={props.sidePanel} />
  ) : (
    <ThreadHeaderBar {...props} />
  );
}

/**
 * With no view open the panel button opens the views menu, and picking one opens the panel on it;
 * with views open it opens the panel on the last one.
 */
function ThreadHeaderWithPanelMenu(
  props: ThreadHeaderProps & { readonly sidePanel: SidePanelEntriesInput },
) {
  const gt = useGT();
  const { thread } = props.sidePanel;
  const threadKey = `${thread.environmentId}:${thread.id}`;
  const panel = useSidePanel(threadKey);
  const { entries, openPullRequest } = useSidePanelEntries(props.sidePanel);
  const open = (surface: SurfaceEntry["surface"]) => {
    if (surface === "pullRequest") return openPullRequest();
    updateSidePanel(threadKey, (state) => openSidePanelSurface(state, surface));
    props.onOpenSidePanel?.();
  };
  const panelMenu: AppBarMenu | undefined =
    panel.tabs.length > 0
      ? undefined
      : {
          title: gt("Open view"),
          icon: "up.panel-bottom",
          items: entries.map((entry) => ({
            id: entry.surface,
            title: entry.label,
            icon: entry.symbol,
            ...(entry.available ? {} : { subtitle: entry.hint, disabled: true }),
            onPress: () => open(entry.surface),
          })),
        };
  return <ThreadHeaderBar {...props} panelMenu={panelMenu} />;
}

function ThreadHeaderBar(props: ThreadHeaderProps & { readonly panelMenu?: AppBarMenu }) {
  const gt = useGT();
  const m = useMessages();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const panelVisible = props.inspectorMode === "panel" && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] =
    props.panelMenu && !panelVisible
      ? []
      : props.onOpenSidePanel
        ? [
            {
              accessibilityLabel: gt("Toggle right panel"),
              icon: "up.panel-bottom",
              selected: panelVisible,
              onPress: panelVisible ? toggleAuxiliaryPane : props.onOpenSidePanel,
            },
          ]
        : props.hasThreadCwd
          ? [
              {
                accessibilityLabel: filesVisible ? gt("Close files") : gt("Open files"),
                icon: "folder",
                selected: filesVisible,
                disabled: !props.gitControls.canOpenFiles,
                separateBackground: false,
                onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
              },
            ]
          : [];
  const menus = props.onOpenSidePanel
    ? props.panelMenu && !panelVisible
      ? [props.panelMenu]
      : []
    : [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  return (
    <AppBar
      title={props.title}
      titleContent={props.bot?.icon}
      titlePill={props.bot}
      subtitle={props.bot ? null : props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
