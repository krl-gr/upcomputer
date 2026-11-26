import type { StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { shortDateTime } from "@t3tools/tasks-client/automations/cronSchedule";
import { useGT, useLocale, useMessages } from "gt-react-native";
import { Alert, View } from "react-native";

import { AppActivityIndicator } from "../../../components/ui/AppActivityIndicator";
import { AppBar } from "../../../components/ui/AppBar";
import { AppText as Text } from "../../../components/ui/AppText";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ListRowLayout } from "../../../components/ui/ListRowLayout";
import { ListSection } from "../../../components/ui/ListSection";
import { ListToggleRow } from "../../../components/ui/ListToggleRow";
import { ScreenContent } from "../../../components/ui/ScreenContent";
import { NativeScrollView } from "../../../native/NativeScrollViewMarker";
import { useProjects } from "../../../state/entities";
import { useWorkspaceState } from "../../../state/workspace";
import { useAdaptiveWorkspaceLayout } from "../../layout/AdaptiveWorkspaceLayout";
import { useAndroidWorkspaceBack } from "../../layout/workspace/useAndroidWorkspaceNavigation";
import { PullRequestSectionHeading } from "../../pull-requests/PullRequestSectionHeading";
import { TaskMarkdown } from "../TaskMarkdown";
import { TaskProjectBadge } from "../TaskProjectBadge";
import { useTasksAccess } from "../tasksRpc";
import { automationStoreFor, useAutomations } from "./automationData";
import {
  AUTOMATION_STATUS_LABELS,
  CATCH_UP_POLICY_LABELS,
  describeAutomationSchedule,
} from "./automationPresentation";

export type AutomationRouteParams = {
  readonly environmentId: string;
  readonly automationId: string;
  /** The row's name, shown while the automation loads. */
  readonly title?: string;
};

/**
 * One automation, as the desktop's automation window shows it: status, schedule, runs, the
 * missed-run policy and the task it creates. Enabling works here; editing stays on the desktop.
 */
export function AutomationRouteScreen({ route }: StaticScreenProps<AutomationRouteParams>) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const returnToList = useAndroidWorkspaceBack();
  const { layout } = useAdaptiveWorkspaceLayout();
  const params = route.params;
  const environmentId = EnvironmentId.make(params.environmentId);
  const { environments } = useWorkspaceState();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const connected = environment?.connectionState === "connected";
  const access = useTasksAccess(connected ? environmentId : null);
  const ready = connected && access?.availability === "enabled";
  const store = automationStoreFor(environmentId);
  const snapshot = useAutomations(store, ready);
  const automation = snapshot.automations.find((entry) => entry.id === params.automationId);
  const project = useProjects().find(
    (entry) => entry.environmentId === environmentId && entry.id === automation?.projectId,
  );
  const canEdit = ready && access?.canMutateAutomations === true;
  const enabled = automation?.status === "enabled";
  const nextRun =
    enabled && automation?.nextRunAt
      ? gt("Next {time}", { time: shortDateTime(automation.nextRunAt, locale) })
      : gt("Not scheduled");
  const subtitle = [project?.title, environment?.environmentLabel, connected ? null : gt("Offline")]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={automation?.name ?? params.title ?? gt("Automation")}
        subtitle={subtitle}
        onBack={layout.usesSplitView ? undefined : returnToList}
        menus={
          automation && canEdit
            ? [
                {
                  title: gt("More actions"),
                  icon: "ellipsis",
                  items: [
                    {
                      id: "status",
                      title: enabled ? gt("Disable") : gt("Enable"),
                      icon: enabled ? "pause.circle" : "play.circle",
                      onPress: () =>
                        void store.setStatus(automation.id, enabled ? "disabled" : "enabled"),
                    },
                    {
                      id: "delete",
                      title: gt("Delete automation"),
                      icon: "trash",
                      destructive: true,
                      onPress: () =>
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
                        ),
                    },
                  ],
                },
              ]
            : []
        }
      />
      <ScreenContent>
        <NativeScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
        >
          {automation === undefined ? (
            !connected ? (
              <EmptyState
                title={gt("Computer offline")}
                detail={gt("Reconnect to load this automation.")}
                variant="plain"
              />
            ) : snapshot.status === "loading" || !ready ? (
              <AppActivityIndicator
                className="my-12"
                colorClassName="accent-icon"
                accessibilityLabel={gt("Loading automations")}
              />
            ) : (
              <EmptyState
                title={gt("This automation was deleted.")}
                detail={snapshot.error ?? ""}
                variant="plain"
              />
            )
          ) : (
            <View className="gap-5">
              <View className="gap-3">
                <View className="flex-row items-center gap-2">
                  <TaskProjectBadge
                    environmentId={environmentId}
                    project={project ?? null}
                    size={20}
                  />
                  <Text className="rounded-md bg-subtle px-1.5 py-px text-xs text-foreground-muted">
                    {messages(AUTOMATION_STATUS_LABELS[automation.status])}
                  </Text>
                </View>
                <Text selectable className="text-xl font-t3-bold leading-7">
                  {automation.name}
                </Text>
                {automation.lastError ? (
                  <Text selectable className="text-sm text-danger-foreground">
                    {automation.lastError}
                  </Text>
                ) : null}
              </View>
              <ListSection>
                <ListToggleRow
                  label={gt("Enabled", { $context: "automation status" })}
                  value={enabled}
                  disabled={!canEdit}
                  onValueChange={(value) =>
                    void store.setStatus(automation.id, value ? "enabled" : "disabled")
                  }
                />
              </ListSection>
              <ListSection>
                <InfoRow
                  label={gt("Schedule")}
                  value={gt("{schedule} · {timezone}", {
                    schedule: describeAutomationSchedule(automation.schedule.cron, messages),
                    timezone: automation.schedule.timezone,
                  })}
                />
                <InfoRow
                  label={gt("Runs", {
                    $context: "label of the automation's next and last run times",
                  })}
                  value={
                    automation.lastFiredAt
                      ? gt("{runs} · last {time}", {
                          runs: nextRun,
                          time: shortDateTime(automation.lastFiredAt, locale),
                        })
                      : nextRun
                  }
                />
                <InfoRow
                  label={gt("Missed run")}
                  value={messages(CATCH_UP_POLICY_LABELS[automation.catchUpPolicy])}
                />
                <InfoRow
                  label={gt("Skip if open")}
                  value={
                    automation.skipIfOpen
                      ? gt("Skip while a task it created is not archived")
                      : gt("Off", { $context: "a setting that is turned off" })
                  }
                />
                {automation.taskCount !== undefined ? (
                  <InfoRow
                    label={gt("Tasks")}
                    value={gt("{count, plural, one {# task} other {# tasks}}", {
                      count: automation.taskCount,
                    })}
                  />
                ) : null}
              </ListSection>
              <View className="gap-2">
                <PullRequestSectionHeading>{gt("Creates a task")}</PullRequestSectionHeading>
                <ListSection>
                  <InfoRow label={gt("Title")} value={automation.template.title} />
                  <InfoRow label={gt("Status")} value={automation.template.status} />
                  {automation.template.tags.length > 0 ? (
                    <InfoRow label={gt("Tags")} value={automation.template.tags.join(", ")} />
                  ) : null}
                </ListSection>
                {automation.template.description.trim() ? (
                  <TaskMarkdown
                    markdown={automation.template.description}
                    environmentId={environmentId}
                    cwd={project?.workspaceRoot ?? null}
                  />
                ) : null}
              </View>
            </View>
          )}
        </NativeScrollView>
      </ScreenContent>
    </View>
  );
}

function InfoRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View accessible accessibilityLabel={`${props.label}, ${props.value}`}>
      <ListRowLayout label={props.label} description={props.value} />
    </View>
  );
}
