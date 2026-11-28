import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { isBotAgent } from "@t3tools/tasks-client/bots/bots";
import type { TaskAgent } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useProjects, useServerConfigs } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import { useAndroidWorkspaceBack } from "../layout/workspace/useAndroidWorkspaceNavigation";
import { TaskProjectBadge } from "../tasks/TaskProjectBadge";
import { readTasksClient, useTasksAccess } from "../tasks/tasksRpc";
import { modelSelectionLabel } from "./modelLabel";

type WorkersState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly agents: ReadonlyArray<TaskAgent> };

/** The desktop's Workers list: each worker's project, name, model and triggers, and its switch. */
export function WorkersScreen() {
  const gt = useGT();
  const returnToList = useAndroidWorkspaceBack();
  const { layout } = useAdaptiveWorkspaceLayout();
  const { environments } = useWorkspaceState();
  const connected = environments.filter(
    (environment) => environment.isEnabled && environment.connectionState === "connected",
  );
  const [pickedEnvironmentId, setPickedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environment =
    connected.find((entry) => entry.environmentId === pickedEnvironmentId) ?? connected[0] ?? null;
  const environmentId = environment?.environmentId ?? null;
  const access = useTasksAccess(environmentId);
  const readable = access?.availability === "enabled" && access.canReadAgents;
  const editable = readable && access.canMutateAgents;
  const configs = useServerConfigs();
  const providers = (environmentId ? configs.get(environmentId)?.providers : undefined) ?? [];
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [projectId, setProjectId] = useState<string | null>(null);
  const [state, setState] = useState<WorkersState>({ status: "loading" });
  const [saving, setSaving] = useState<string | null>(null);

  const [revision, setRevision] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the picked computer's workers over its Tasks RPC, again after a change
  useEffect(() => {
    const client = readable && environmentId ? readTasksClient(environmentId) : null;
    if (!client) return;
    let current = true;
    client.agents
      .search({})
      .then((result) => {
        if (current) setState({ status: "ready", agents: result.agents });
      })
      .catch((error: unknown) => {
        if (current)
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      current = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a pause or resume bumps the revision to reload the list
  }, [environmentId, readable, revision]);

  const toggle = async (agent: TaskAgent) => {
    const client = environmentId ? readTasksClient(environmentId) : null;
    if (!client) return;
    setSaving(agent.id);
    try {
      await client.agents.upsert({
        id: agent.id,
        projectId: agent.projectId,
        name: agent.name,
        enabled: !agent.enabled,
        startStatuses: [...agent.startStatuses],
        startTags: [...agent.startTags],
        startRunStatuses: [...agent.startRunStatuses],
        config: agent.config,
      });
      setRevision((value) => value + 1);
    } catch (error) {
      Dialog.alert(
        gt("Failed to update worker"),
        error instanceof Error ? error.message : String(error),
      );
    }
    setSaving(null);
  };

  const workers =
    state.status === "ready"
      ? state.agents.filter(
          (agent) =>
            !isBotAgent(agent) &&
            agent.archivedAt === null &&
            (projectId === null || agent.projectId === projectId),
        )
      : [];
  const projectOf = (agent: TaskAgent): EnvironmentProject | null =>
    projects.find((project) => project.id === agent.projectId) ?? null;
  const pickedProject = projects.find((project) => project.id === projectId);

  return (
    <View className="flex-1 bg-screen">
      <AppBar title={gt("Workers")} onBack={layout.usesSplitView ? undefined : returnToList} />
      <ScreenContent>
        <NativeScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ overflow: "visible" }}
            contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
          >
            {connected.length > 1 && environment ? (
              <ListFilterMenu
                label={environment.environmentLabel}
                accessibilityLabel={gt("Computer")}
                actions={connected.map((entry) => ({
                  id: entry.environmentId,
                  title: entry.environmentLabel,
                  state: entry.environmentId === environmentId ? "on" : "off",
                }))}
                onSelect={(id) => {
                  setPickedEnvironmentId(id as EnvironmentId);
                  setProjectId(null);
                  setState({ status: "loading" });
                }}
              />
            ) : null}
            <ListFilterMenu
              label={pickedProject?.title ?? gt("All projects")}
              accessibilityLabel={gt("Project")}
              active={pickedProject !== undefined}
              actions={[
                { id: "all", title: gt("All projects"), state: projectId === null ? "on" : "off" },
                ...projects.map((project) => ({
                  id: String(project.id),
                  title: project.title,
                  state: project.id === projectId ? ("on" as const) : ("off" as const),
                })),
              ]}
              onSelect={(id) => setProjectId(id === "all" ? null : id)}
            />
          </ScrollView>
          {environment === null ? (
            <EmptyState
              variant="plain"
              title={gt("Computer offline")}
              detail={gt("Reconnect to load workers.")}
            />
          ) : !readable && access?.availability !== "loading" && access !== null ? (
            <EmptyState
              variant="plain"
              title={gt("Workers unavailable")}
              detail={gt("This computer doesn't share its workers with this device.")}
            />
          ) : state.status === "loading" ? (
            <AppActivityIndicator
              className="my-12"
              colorClassName="accent-icon"
              accessibilityLabel={gt("Loading workers")}
            />
          ) : state.status === "failed" ? (
            <EmptyState variant="plain" title={gt("Workers didn't load")} detail={state.message} />
          ) : workers.length === 0 ? (
            <EmptyState
              variant="plain"
              title={gt("No workers yet")}
              detail={gt("Create workers on the desktop app.")}
            />
          ) : (
            <ListSection>
              {workers.map((agent) => (
                <ListRowLayout
                  key={agent.id}
                  leading={
                    <TaskProjectBadge
                      environmentId={environment.environmentId}
                      project={projectOf(agent)}
                      size={22}
                    />
                  }
                  label={agent.name}
                  description={[
                    modelSelectionLabel(providers, agent.config.modelSelection),
                    agent.startStatuses.length > 0
                      ? agent.startStatuses.join(", ")
                      : gt("Any status"),
                    agent.startTags.length > 0 ? agent.startTags.join(", ") : gt("Any tag"),
                  ].join(" · ")}
                  accessory={
                    <ThemedSwitch
                      accessibilityLabel={
                        agent.enabled
                          ? gt("Pause {name}", { name: agent.name })
                          : gt("Resume {name}", { name: agent.name })
                      }
                      disabled={!editable || saving !== null}
                      value={agent.enabled}
                      onValueChange={() => void toggle(agent)}
                    />
                  }
                />
              ))}
            </ListSection>
          )}
        </NativeScrollView>
      </ScreenContent>
    </View>
  );
}
