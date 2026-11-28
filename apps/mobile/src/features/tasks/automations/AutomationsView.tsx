import { LegendList } from "@legendapp/list/react-native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TaskAutomationListItem } from "@t3tools/tasks-contracts/v1";
import { useGT, useLocale, useMessages } from "gt-react-native";
import { memo, type ReactNode } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../../components/ui/AppText";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Menu } from "../../../components/ui/Menu";
import { useContentTopInset } from "../../../components/ui/useBarInset";
import { cn } from "../../../lib/cn";
import { NativeScrollView } from "../../../native/NativeScrollViewMarker";
import { useNativeColumnLayoutMetrics } from "../../../native/native-layout-metrics";
import { useProjects } from "../../../state/entities";
import { useSelectWorkspaceDetail } from "../../layout/workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../../layout/workspace/WorkspaceTabsContext";
import { RowControl } from "../RowControl";
import { TaskProjectBadge } from "../TaskProjectBadge";
import { TasksToolbar } from "../TasksHeader";
import type { tasksEnvironments } from "../taskListState";
import { useTasksAccess } from "../tasksRpc";
import { automationStoreFor, useAutomations } from "./automationData";
import { AUTOMATION_STATUS_LABELS, automationScheduleLine } from "./automationPresentation";

/**
 * Automations: the computer's automations in the person's order, as the desktop's list shows
 * them. A row opens the automation; its menu enables, disables or deletes it.
 */
export function AutomationsView(props: {
  readonly environmentId: EnvironmentId | null;
  readonly environment: ReturnType<typeof tasksEnvironments>[number] | null;
  readonly connected: boolean;
  readonly sidebar: boolean;
  readonly environmentMenu: ReactNode;
}) {
  const gt = useGT();
  const { environmentId, connected } = props;
  const access = useTasksAccess(connected ? environmentId : null);
  const ready = connected && access?.availability === "enabled" && environmentId !== null;
  const toolbar = (
    <TasksToolbar
      createLabel={gt("New automation")}
      // Creating and editing an automation stays on the desktop for now.
      createDisabled
      onCreate={() => undefined}
      menuLabel={gt("Views", { $context: "menu that switches the Tasks tab's view" })}
      applied={false}
      sections={props.environmentMenu}
    />
  );
  if (!ready || environmentId === null)
    return (
      <AutomationsShell sidebar={props.sidebar} toolbar={toolbar}>
        <AutomationsGate
          state={
            props.environment === null
              ? "noEnvironment"
              : !connected
                ? "offline"
                : access?.availability === "unavailable"
                  ? "unavailable"
                  : "loading"
          }
        />
      </AutomationsShell>
    );
  return (
    <AutomationsList
      key={environmentId}
      environmentId={environmentId}
      canEdit={access?.canMutateAutomations === true}
      sidebar={props.sidebar}
      toolbar={toolbar}
    />
  );
}

function AutomationsList(props: {
  readonly environmentId: EnvironmentId;
  readonly canEdit: boolean;
  readonly sidebar: boolean;
  readonly toolbar: ReactNode;
}) {
  const gt = useGT();
  const store = automationStoreFor(props.environmentId);
  const snapshot = useAutomations(store, true);
  const projects = useProjects();
  const projectById = new Map<string, EnvironmentProject>(
    projects
      .filter((project) => project.environmentId === props.environmentId)
      .map((project) => [project.id, project]),
  );
  const selectDetail = useSelectWorkspaceDetail();
  const open = (automation: TaskAutomationListItem) =>
    selectDetail({
      name: "Automation",
      params: {
        environmentId: String(props.environmentId),
        automationId: automation.id,
        title: automation.name,
      },
    });
  const confirmDelete = (automation: TaskAutomationListItem) =>
    Alert.alert(
      gt("Delete automation"),
      gt(
        '"{name}" stops creating tasks. The tasks it created stay in the table. This cannot be undone.',
        { name: automation.name },
      ),
      [
        { text: gt("Cancel"), style: "cancel" },
        {
          text: gt("Delete", { $context: "button that confirms deleting" }),
          style: "destructive",
          onPress: () => void store.remove(automation.id),
        },
      ],
    );
  const rows = snapshot.automations;
  return (
    <AutomationsShell
      sidebar={props.sidebar}
      toolbar={props.toolbar}
      rows={rows}
      renderRow={(automation) => (
        <AutomationRow
          automation={automation}
          project={projectById.get(automation.projectId) ?? null}
          environmentId={props.environmentId}
          canEdit={props.canEdit}
          onOpen={open}
          onSetStatus={(status) => void store.setStatus(automation.id, status)}
          onDelete={confirmDelete}
        />
      )}
    >
      {snapshot.status === "loading" ? (
        <AutomationsGate state="loading" />
      ) : snapshot.error ? (
        <View className="px-8 py-12">
          <EmptyState
            title={gt("Automations didn't load")}
            detail={snapshot.error}
            variant="plain"
          />
        </View>
      ) : (
        <View className="px-8 py-12">
          <EmptyState
            title={gt("No automations yet")}
            detail={gt("An automation creates a task for workers on a schedule.")}
            variant="plain"
          />
        </View>
      )}
    </AutomationsShell>
  );
}

function AutomationsShell(props: {
  readonly sidebar: boolean;
  readonly toolbar: ReactNode;
  readonly rows?: readonly TaskAutomationListItem[];
  readonly renderRow?: (automation: TaskAutomationListItem) => ReactNode;
  readonly children: ReactNode;
}) {
  // Absent in the chat's side panel, which shows these views outside the workspace tabs.
  const workspace = useWorkspaceTabs();
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const columnSafeBottom = useNativeColumnLayoutMetrics()?.safeArea.bottom;
  const bottomSafeArea =
    Platform.OS === "ios" ? (columnSafeBottom ?? insets.bottom) : insets.bottom;
  return (
    <View className={props.sidebar ? "flex-1 bg-drawer" : "flex-1 bg-screen"}>
      {props.toolbar}
      <LegendList
        data={props.rows ?? []}
        keyExtractor={(automation) => automation.id}
        estimatedItemSize={112}
        drawDistance={1_000}
        alwaysBounceVertical
        showsVerticalScrollIndicator={Platform.OS !== "android"}
        recycleItems
        renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
        contentInsetAdjustmentBehavior="never"
        contentInset={Platform.OS === "ios" ? { top: contentTopInset } : undefined}
        contentContainerStyle={{
          paddingTop: 4,
          paddingBottom: Math.max(bottomSafeArea, workspace?.bottomClearance ?? 0),
        }}
        renderItem={({ item }) => <>{props.renderRow?.(item)}</>}
        ListEmptyComponent={<>{props.children}</>}
      />
    </View>
  );
}

function AutomationsGate(props: {
  readonly state: "noEnvironment" | "offline" | "unavailable" | "loading";
}) {
  const gt = useGT();
  if (props.state === "loading")
    return (
      <View className="items-center py-12">
        <AppActivityIndicator
          colorClassName="accent-icon"
          accessibilityLabel={gt("Loading automations")}
        />
      </View>
    );
  const copy = {
    noEnvironment: {
      title: gt("Connect a computer"),
      detail: gt("Add an environment in Settings to see its automations."),
    },
    offline: { title: gt("Computer offline"), detail: gt("Reconnect to load its automations.") },
    unavailable: {
      title: gt("Tasks unavailable"),
      detail: gt("Update this computer's Up.computer to see its tasks here."),
    },
  }[props.state];
  return (
    <View className="px-8 py-12">
      <EmptyState title={copy.title} detail={copy.detail} variant="plain" />
    </View>
  );
}

/**
 * The desktop's automation row: the name, then project, status, schedule with the next run,
 * how many tasks it created, Open automation and More actions.
 */
const AutomationRow = memo(function AutomationRow(props: {
  readonly automation: TaskAutomationListItem;
  readonly project: EnvironmentProject | null;
  readonly environmentId: EnvironmentId;
  readonly canEdit: boolean;
  readonly onOpen: (automation: TaskAutomationListItem) => void;
  readonly onSetStatus: (status: "enabled" | "disabled") => void;
  readonly onDelete: (automation: TaskAutomationListItem) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const { automation } = props;
  const enabled = automation.status === "enabled";
  const schedule = automationScheduleLine(automation, messages, locale);
  const status = messages(AUTOMATION_STATUS_LABELS[automation.status]);
  const count = automation.taskCount ?? null;
  const more = (
    <RowControl
      icon="more-horizontal"
      accessibilityLabel={gt("More actions")}
      disabled={!props.canEdit}
    />
  );
  return (
    <View className="px-4 py-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[automation.name, props.project?.title, status, schedule]
          .filter(Boolean)
          .join(", ")}
        onPress={() => props.onOpen(automation)}
        className="gap-2 active:opacity-70"
      >
        <Text
          className={cn(
            "text-base font-t3-medium leading-5",
            enabled ? "text-foreground" : "text-foreground-muted",
          )}
        >
          {automation.name}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <TaskProjectBadge environmentId={props.environmentId} project={props.project} size={20} />
          <Text className="rounded-md bg-subtle px-1.5 py-px text-xs text-foreground-muted">
            {status}
          </Text>
        </View>
        <Text className="text-sm text-foreground-muted">{schedule}</Text>
      </Pressable>
      <View className="mt-1.5 flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-sm text-foreground-muted">
          {count !== null ? gt("{count, plural, one {# task} other {# tasks}}", { count }) : ""}
        </Text>
        <RowControl
          icon="expand-diagonal"
          accessibilityLabel={gt("Open automation")}
          onPress={() => props.onOpen(automation)}
        />
        {props.canEdit ? (
          <Menu
            title={automation.name}
            actions={[
              {
                id: "status",
                title: enabled ? gt("Disable") : gt("Enable"),
                image: enabled ? "pause.circle" : "play.circle",
              },
              {
                id: "delete",
                title: gt("Delete automation"),
                image: "trash",
                attributes: { destructive: true },
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "status")
                props.onSetStatus(enabled ? "disabled" : "enabled");
              else if (nativeEvent.event === "delete") props.onDelete(automation);
            }}
          >
            {more}
          </Menu>
        ) : (
          more
        )}
      </View>
    </View>
  );
});
