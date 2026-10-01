import { useCallback, useMemo } from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ProviderInstanceId } from "@upcomputer/contracts";

import { usePrimarySettings } from "../../../../apps/web/src/hooks/useSettings.ts";
import {
  getAppModelOptionsForInstance,
  type AppModelOption,
} from "../../../../apps/web/src/modelSelection.ts";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../../../apps/web/src/providerInstances.ts";
import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";

import { AgentsView } from "./AgentsView.tsx";
import { useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { useViewProjectFilter } from "./useViewProjectFilter.ts";

export default function AgentsRoute() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const selectedAgentKey = useLocation({
    select: (location) => {
      const agent = (location.search as Record<string, unknown>).agent;
      return typeof agent === "string" && agent.length > 0 ? agent : undefined;
    },
  });
  const data = useTasksWorkspaceData();
  const projectFilter = useViewProjectFilter();
  const serverConfigs = useServerConfigs();
  const settings = usePrimarySettings();
  const providerCatalogByEnvironment = useMemo(() => {
    const catalogs = new Map<
      EnvironmentId,
      {
        readonly entries: ReturnType<typeof deriveProviderInstanceEntries>;
        readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, readonly AppModelOption[]>;
      }
    >();
    for (const environmentId of new Set(
      data.agentProjects.map((project) => project.environmentId),
    )) {
      const config = serverConfigs.get(environmentId) ?? null;
      if (!config) continue;
      const entries = sortProviderInstanceEntries(deriveProviderInstanceEntries(config.providers));
      const modelOptionsByInstance = new Map<ProviderInstanceId, readonly AppModelOption[]>();
      for (const entry of entries) {
        modelOptionsByInstance.set(
          entry.instanceId,
          getAppModelOptionsForInstance(settings, entry),
        );
      }
      catalogs.set(environmentId, { entries, modelOptionsByInstance });
    }
    return catalogs;
  }, [data.agentProjects, serverConfigs, settings]);
  const navigateBack = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({
      to: selectedAgentKey ? "/agents" : "/",
      ...(selectedAgentKey ? { search: {}, replace: true } : {}),
    });
  }, [canGoBack, navigate, selectedAgentKey]);

  return (
    <AgentsView
      projects={data.agentProjects}
      agents={data.agents.agents}
      projectFilter={projectFilter}
      tasks={data.tasks.tasks}
      runs={data.agents.runs}
      status={data.agentsStatus}
      {...(selectedAgentKey === undefined ? {} : { initialSelectedAgentKey: selectedAgentKey })}
      {...(data.agentsErrorMessage === undefined ? {} : { errorMessage: data.agentsErrorMessage })}
      canMutateEnvironment={data.canMutateAgents}
      providerCatalogByEnvironment={providerCatalogByEnvironment}
      getClient={data.getClient}
      onReload={data.reload}
      onNavigateBack={navigateBack}
      onSelectedAgentKeyChange={(agentKey) => {
        void navigate({
          to: "/agents",
          search: agentKey ? { agent: agentKey } : {},
          ...(agentKey ? {} : { replace: true }),
        });
      }}
      onOpenTask={(environmentId, taskId) => {
        void navigate({
          to: "/tasks",
          search: { task: `${environmentId}:${taskId}` },
        });
      }}
      onOpenThread={(environmentId, threadId) => {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
        });
      }}
    />
  );
}
