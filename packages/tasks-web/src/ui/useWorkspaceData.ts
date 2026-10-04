import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sameTaskTargets } from "../state/taskPages.ts";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  loadAgentsState,
  loadAutomationsState,
  loadTasksState,
  compareScopedTaskOrder,
  type AgentsDataState,
  type AgentsStateTarget,
  type AutomationsDataState,
  type AutomationsStateTarget,
  type TasksDataState,
  type TasksStateTarget,
} from "../state/index.ts";
import type { TasksWebAccess, TasksWebRpcClient } from "../rpc/index.ts";
import {
  readTasksWebAccess,
  readTasksWebClient,
  useTasksWebAccessRevision,
} from "../environmentApi.ts";
import { useProjects, useServerConfigs } from "../../../../apps/web/src/state/entities.ts";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../../../apps/web/src/state/environments.ts";
import { useUiStateStore } from "../../../../apps/web/src/uiStateStore.ts";
import { usePrimarySettings } from "../../../../apps/web/src/hooks/useSettings.ts";
import {
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../../../../apps/web/src/logicalProject.ts";
import { buildSidebarProjectSnapshots } from "../../../../apps/web/src/sidebarProjectGrouping.ts";
import { orderItemsByPreferredIds } from "../../../../apps/web/src/components/Sidebar.logic.ts";

import type { AgentProject } from "./AgentsView.tsx";
import type { TasksWebProject } from "./shared.ts";

const EMPTY_TASKS: TasksDataState = { byEnvironment: {}, tasks: [] };
const EMPTY_AGENTS: AgentsDataState = { byEnvironment: {}, agents: [], runs: [] };
const EMPTY_AUTOMATIONS: AutomationsDataState = {
  byEnvironment: {},
  automations: [],
  runs: [],
};

export interface TasksWorkspaceData {
  readonly taskTargets: readonly TasksStateTarget[];
  readonly projects: readonly TasksWebProject[];
  readonly agentProjects: readonly AgentProject[];
  readonly tasks: TasksDataState;
  readonly agents: AgentsDataState;
  readonly automations: AutomationsDataState;
  readonly tasksStatus: "loading" | "ready" | "error";
  readonly tasksErrorMessage?: string;
  readonly agentsStatus: "loading" | "ready" | "error";
  readonly agentsErrorMessage?: string;
  readonly automationsStatus: "loading" | "ready" | "error";
  readonly automationsErrorMessage?: string;
  readonly getClient: (environmentId: EnvironmentId) => TasksWebRpcClient | null;
  readonly canMutateTasks: (environmentId: EnvironmentId) => boolean;
  readonly canMutateAgents: (environmentId: EnvironmentId) => boolean;
  readonly canMutateAutomations: (environmentId: EnvironmentId) => boolean;
  readonly reload: () => void;
}

/** The sidebar's logical projects, grouped and ordered as the sidebar shows them. */
export function useSidebarProjectSnapshots() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const grouping = usePrimarySettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentLabelById = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const ordered = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projectOrder, projects],
  );

  return useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: ordered,
        settings: grouping,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [environmentLabelById, grouping, ordered, primaryEnvironmentId],
  );
}

function useWorkspaceProjects(): {
  projects: readonly TasksWebProject[];
  agentProjects: readonly AgentProject[];
} {
  const snapshots = useSidebarProjectSnapshots();
  return useMemo(() => {
    const members = snapshots.flatMap((snapshot) => snapshot.memberProjects);
    return {
      projects: members.map((member) => ({
        environmentId: member.environmentId,
        id: member.id,
        name: member.title,
        workspaceRoot: member.workspaceRoot,
        repositoryIdentity: member.repositoryIdentity,
        favicon: member,
      })),
      agentProjects: members.flatMap((member) =>
        member.defaultModelSelection
          ? [
              {
                environmentId: member.environmentId,
                id: member.id,
                name: member.title,
                workspaceRoot: member.workspaceRoot,
                repositoryIdentity: member.repositoryIdentity,
                favicon: member,
                defaultModelSelection: member.defaultModelSelection,
              },
            ]
          : [],
      ),
    };
  }, [snapshots]);
}

function viewStatus(
  loading: boolean,
  states: ReadonlyArray<{
    readonly status: "loading" | "ready" | "unavailable" | "error";
    readonly message?: string;
  }>,
): { readonly status: "loading" | "ready" | "error"; readonly message?: string } {
  if (loading) return { status: "loading" };
  if (states.length === 0 || states.some((state) => state.status === "ready")) {
    return { status: "ready" };
  }
  const failure = states.find(
    (state) => state.status === "error" || state.status === "unavailable",
  );
  return failure?.message ? { status: "error", message: failure.message } : { status: "ready" };
}

export function useTasksWorkspaceData(loadLegacyTasks = true): TasksWorkspaceData {
  const { projects, agentProjects } = useWorkspaceProjects();
  // These subscriptions make authoritative manifest and connection changes
  // recompute access for every environment, including saved remotes.
  const serverConfigs = useServerConfigs();
  const [reloadVersion, setReloadVersion] = useState(0);
  const [tasks, setTasks] = useState<TasksDataState>(EMPTY_TASKS);
  const [agents, setAgents] = useState<AgentsDataState>(EMPTY_AGENTS);
  const [automations, setAutomations] = useState<AutomationsDataState>(EMPTY_AUTOMATIONS);
  const [loading, setLoading] = useState(true);
  const priorTasks = useRef<TasksDataState>(EMPTY_TASKS);
  const priorAgents = useRef<AgentsDataState>(EMPTY_AGENTS);
  const priorAutomations = useRef<AutomationsDataState>(EMPTY_AUTOMATIONS);

  const environmentIds = useMemo(
    () => [...new Set(projects.map(({ environmentId }) => environmentId))],
    [projects],
  );
  const projectNamesByEnvironment = useMemo(() => {
    const result = new Map<EnvironmentId, Map<ProjectId, string>>();
    for (const project of projects) {
      const names = result.get(project.environmentId) ?? new Map<ProjectId, string>();
      names.set(project.id, project.name);
      result.set(project.environmentId, names);
    }
    return result;
  }, [projects]);

  const accessRevision = useTasksWebAccessRevision();
  const clientsAndAccess = useMemo(() => {
    const result = new Map<EnvironmentId, { client: TasksWebRpcClient; access: TasksWebAccess }>();
    for (const environmentId of environmentIds) {
      const client = readTasksWebClient(environmentId);
      const access = readTasksWebAccess(environmentId);
      result.set(environmentId, { client, access });
    }
    return result;
  }, [environmentIds, reloadVersion, serverConfigs, accessRevision]);

  const previousTaskTargets = useRef<readonly TasksStateTarget[]>([]);
  const taskTargets = useMemo(() => {
    const next = environmentIds.flatMap((environmentId) => {
      const entry = clientsAndAccess.get(environmentId);
      return entry
        ? [
            {
              environmentId,
              ...entry,
              projectNameById: projectNamesByEnvironment.get(environmentId) ?? new Map(),
            },
          ]
        : [];
    });
    if (!sameTaskTargets(previousTaskTargets.current, next)) previousTaskTargets.current = next;
    return previousTaskTargets.current;
  }, [clientsAndAccess, environmentIds, projectNamesByEnvironment]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const taskTargets: TasksStateTarget[] = [];
    const agentTargets: AgentsStateTarget[] = [];
    const automationTargets: AutomationsStateTarget[] = [];
    for (const [environmentId, entry] of clientsAndAccess) {
      const projectNameById = projectNamesByEnvironment.get(environmentId);
      const target = {
        environmentId,
        ...entry,
        ...(projectNameById === undefined ? {} : { projectNameById }),
      };
      taskTargets.push(target);
      agentTargets.push(target);
      automationTargets.push(target);
    }
    void Promise.all([
      loadLegacyTasks
        ? loadTasksState(taskTargets, priorTasks.current)
        : Promise.resolve(EMPTY_TASKS),
      loadAgentsState(agentTargets, priorAgents.current),
      loadAutomationsState(automationTargets, priorAutomations.current),
    ]).then(([nextTasks, nextAgents, nextAutomations]) => {
      if (cancelled) return;
      const taskStates = { ...nextTasks.byEnvironment };
      const agentStates = { ...nextAgents.byEnvironment };
      const automationStates = { ...nextAutomations.byEnvironment };
      for (const environmentId of environmentIds) {
        if (clientsAndAccess.has(environmentId)) continue;
        const priorTaskState = priorTasks.current.byEnvironment[environmentId];
        const priorAgentState = priorAgents.current.byEnvironment[environmentId];
        const priorAutomationState = priorAutomations.current.byEnvironment[environmentId];
        taskStates[environmentId] = {
          status: "unavailable",
          tasks: priorTaskState?.tasks ?? [],
          message: "The extension connection is unavailable for this environment.",
        };
        agentStates[environmentId] = {
          status: "unavailable",
          agents: priorAgentState?.agents ?? [],
          runs: priorAgentState?.runs ?? [],
          message: "The extension connection is unavailable for this environment.",
        };
        automationStates[environmentId] = {
          status: "unavailable",
          automations: priorAutomationState?.automations ?? [],
          runs: priorAutomationState?.runs ?? [],
          message: "The extension connection is unavailable for this environment.",
        };
      }
      const mergedTasks: TasksDataState = {
        byEnvironment: taskStates,
        tasks: Object.values(taskStates)
          .flatMap((state) => state.tasks)
          .sort(compareScopedTaskOrder),
      };
      const mergedAgents: AgentsDataState = {
        byEnvironment: agentStates,
        agents: Object.values(agentStates)
          .flatMap((state) => state.agents)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        runs: Object.values(agentStates)
          .flatMap((state) => state.runs)
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
      };
      const mergedAutomations: AutomationsDataState = {
        byEnvironment: automationStates,
        automations: Object.values(automationStates)
          .flatMap((state) => state.automations)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        runs: Object.values(automationStates)
          .flatMap((state) => state.runs)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      };
      priorTasks.current = mergedTasks;
      priorAgents.current = mergedAgents;
      priorAutomations.current = mergedAutomations;
      setTasks(mergedTasks);
      setAgents(mergedAgents);
      setAutomations(mergedAutomations);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clientsAndAccess, environmentIds, projectNamesByEnvironment, reloadVersion, loadLegacyTasks]);

  const getClient = useCallback(
    (environmentId: EnvironmentId) => clientsAndAccess.get(environmentId)?.client ?? null,
    [clientsAndAccess],
  );
  const canMutateTasks = useCallback(
    (environmentId: EnvironmentId) =>
      clientsAndAccess.get(environmentId)?.access.canMutateTasks ?? false,
    [clientsAndAccess],
  );
  const canMutateAgents = useCallback(
    (environmentId: EnvironmentId) =>
      clientsAndAccess.get(environmentId)?.access.canMutateAgents ?? false,
    [clientsAndAccess],
  );
  const canMutateAutomations = useCallback(
    (environmentId: EnvironmentId) =>
      clientsAndAccess.get(environmentId)?.access.canMutateAutomations ?? false,
    [clientsAndAccess],
  );
  const reload = useCallback(() => setReloadVersion((current) => current + 1), []);
  const tasksViewStatus = viewStatus(loading, Object.values(tasks.byEnvironment));
  const agentsViewStatus = viewStatus(loading, Object.values(agents.byEnvironment));
  const automationsViewStatus = viewStatus(loading, Object.values(automations.byEnvironment));

  return {
    taskTargets,
    projects,
    agentProjects,
    tasks,
    agents,
    automations,
    tasksStatus: tasksViewStatus.status,
    ...(tasksViewStatus.message ? { tasksErrorMessage: tasksViewStatus.message } : {}),
    agentsStatus: agentsViewStatus.status,
    ...(agentsViewStatus.message ? { agentsErrorMessage: agentsViewStatus.message } : {}),
    automationsStatus: automationsViewStatus.status,
    ...(automationsViewStatus.message
      ? { automationsErrorMessage: automationsViewStatus.message }
      : {}),
    getClient,
    canMutateTasks,
    canMutateAgents,
    canMutateAutomations,
    reload,
  };
}
