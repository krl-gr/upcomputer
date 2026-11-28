import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { DEFAULT_TASK_STATUS } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Menu } from "../../components/ui/Menu";
import { useProjects } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { PullRequestSheetContent } from "../pull-requests/PullRequestSheetContent";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { plannerStoreFor } from "./planner/plannerData";
import { canCreateTask, taskStatusChoices } from "./taskListState";
import { readTasksClient, useTasksAccess } from "./tasksRpc";
import { useTaskWorkflow } from "./useTasks";

export type TaskCreateParams = {
  readonly environmentId: string;
  /** Your own task or routine, for the planner; left out for a worker task. */
  readonly plannerKind?: "task" | "routine";
  /** Opened from a chat's side panel: the new task opens over the chat, so Back returns there. */
  readonly overPage?: boolean;
};

/** A pick-one field: a chip that opens a native menu. */
function MenuField(props: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly selected: string;
  readonly disabled?: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const { themeAppearance } = useAppearancePreferences();
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Menu
        title={props.label}
        actions={props.options.map((option) => ({
          id: option.id,
          title: option.title,
          state: option.id === props.selected ? "on" : "off",
        }))}
        onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
        // The keyboard would cover the menu's lower items.
        onOpenMenu={() => Keyboard.dismiss()}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label}, ${props.value}`}
          disabled={props.disabled}
          hitSlop={6}
        >
          <Chip
            label={props.value}
            trailingIcon="chevron.down"
            glass
            colorScheme={themeAppearance}
          />
        </Pressable>
      </Menu>
    </View>
  );
}

const INBOX = "inbox";

export function TaskCreateScreen({ route }: StaticScreenProps<TaskCreateParams>) {
  const gt = useGT();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const { environments } = useWorkspaceState();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const connected = environment?.connectionState === "connected";
  const access = useTasksAccess(connected ? environmentId : null);
  const workflow = useTaskWorkflow(environmentId, access);
  const projects = useProjects()
    .filter((project) => project.environmentId === environmentId && project.isScratch !== true)
    .sort((left, right) => left.title.localeCompare(right.title));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>(DEFAULT_TASK_STATUS);
  const [projectId, setProjectId] = useState<string>(INBOX);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const allowed = connected && access?.canMutateTasks === true;
  const plannerKind = route.params.plannerKind;
  const routine = plannerKind === "routine";
  const draft = { title, description, status };
  const project = projects.find((entry) => entry.id === projectId) ?? null;

  const create = async () => {
    if (!allowed || !canCreateTask(draft) || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    if (plannerKind !== undefined) {
      // The planner shows it at once and words a failure itself.
      const ok = await plannerStoreFor(environmentId).createTask({
        title: title.trim(),
        description: description.trim(),
        kind: plannerKind,
        ...(project === null ? {} : { projectId: project.id as ProjectId }),
      });
      inFlight.current = false;
      setBusy(false);
      if (ok) navigation.goBack();
      return;
    }
    const created = await readTasksClient(environmentId)
      .tasks.create({
        title: title.trim(),
        description: description.trim(),
        status,
        ...(project === null ? {} : { projectId: project.id }),
        // The workers' side, as the desktop's task table creates them.
        audience: "agent",
      })
      .then(
        (task) => task,
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          return null;
        },
      );
    inFlight.current = false;
    setBusy(false);
    if (created === null) return;
    const page = {
      environmentId: String(environmentId),
      taskId: String(created.id),
      title: created.title,
    };
    // Over a chat the form becomes the task's page: closing it first would refocus the chat.
    if (route.params.overPage) return navigation.dispatch(StackActions.replace("Task", page));
    navigation.goBack();
    selectDetail({ name: "Task", params: page });
  };

  return (
    <PullRequestSheetContent
      busy={busy}
      title={routine ? gt("New routine") : gt("New task")}
      subtitle={environment?.environmentLabel ?? ""}
      footer={
        <Button
          fullWidth
          tone="contrast"
          label={busy ? gt("Creating…") : routine ? gt("Create routine") : gt("Create task")}
          loading={busy}
          disabled={!allowed || !canCreateTask(draft)}
          onPress={() => void create()}
        />
      }
    >
      <TextInput
        autoFocus
        editable={!busy}
        accessibilityLabel={routine ? gt("Routine title") : gt("Task title")}
        placeholder={gt("Title", { $context: "task title field" })}
        placeholderTextColorClassName="accent-foreground-muted"
        maxLength={1024}
        value={title}
        onChangeText={setTitle}
        returnKeyType="next"
        className="min-h-12 rounded-[20px] bg-grouped-card px-4 text-base text-foreground"
      />
      <View className="gap-3 rounded-[20px] bg-grouped-card px-4 py-3">
        {plannerKind !== undefined ? null : (
          <MenuField
            label={gt("Status")}
            value={status}
            selected={status}
            options={
              workflow.version === null
                ? []
                : taskStatusChoices(workflow.version, null).map((choice) => ({
                    id: choice,
                    title: choice,
                  }))
            }
            disabled={busy || workflow.version === null}
            onSelect={setStatus}
          />
        )}
        <MenuField
          label={gt("Project")}
          value={
            project?.title ?? gt("Inbox", { $context: "the project a task goes to without one" })
          }
          selected={projectId}
          options={[
            {
              id: INBOX,
              title: gt("Inbox", { $context: "the project a task goes to without one" }),
            },
            ...projects.map((entry) => ({ id: String(entry.id), title: entry.title })),
          ]}
          disabled={busy}
          onSelect={setProjectId}
        />
      </View>
      <TextInput
        multiline
        editable={!busy}
        accessibilityLabel={gt("Task description")}
        placeholder={gt("Description, in Markdown")}
        placeholderTextColorClassName="accent-foreground-muted"
        maxLength={65536}
        value={description}
        onChangeText={setDescription}
        className="min-h-36 rounded-[20px] bg-grouped-card p-4 text-base text-foreground"
        style={{ textAlignVertical: "top" }}
      />
      {!allowed ? (
        <Text className="text-xs text-foreground-muted">
          {connected
            ? gt("This computer doesn't let this device create tasks.")
            : gt("Reconnect to this computer to create a task.")}
        </Text>
      ) : null}
      {workflow.error && plannerKind === undefined ? (
        <Text selectable className="text-xs text-foreground-muted">
          {gt("Couldn't load this computer's task statuses: {error}", { error: workflow.error })}
        </Text>
      ) : null}
      {error ? (
        <Text selectable className="text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </PullRequestSheetContent>
  );
}
