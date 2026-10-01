import { useCallback } from "react";
import { useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { AutomationsView } from "./AutomationsView.tsx";
import { useTasksWorkspaceData } from "./useWorkspaceData.ts";
import { useViewProjectFilter } from "./useViewProjectFilter.ts";

export default function AutomationsRoute() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const selectedAutomationKey = useLocation({
    select: (location) => {
      const automation = (location.search as Record<string, unknown>).automation;
      return typeof automation === "string" && automation.length > 0 ? automation : undefined;
    },
  });
  const data = useTasksWorkspaceData();
  const projectFilter = useViewProjectFilter();
  const navigateBack = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({
      to: selectedAutomationKey ? "/automations" : "/",
      ...(selectedAutomationKey ? { search: {}, replace: true } : {}),
    } as never);
  }, [canGoBack, navigate, selectedAutomationKey]);

  return (
    <AutomationsView
      projects={data.projects}
      automations={data.automations.automations}
      projectFilter={projectFilter}
      tasks={data.tasks.tasks}
      runs={data.automations.runs}
      status={data.automationsStatus}
      {...(selectedAutomationKey === undefined
        ? {}
        : { initialSelectedAutomationKey: selectedAutomationKey })}
      {...(data.automationsErrorMessage === undefined
        ? {}
        : { errorMessage: data.automationsErrorMessage })}
      canMutateEnvironment={data.canMutateAutomations}
      getClient={data.getClient}
      onReload={data.reload}
      onNavigateBack={navigateBack}
      onSelectedAutomationKeyChange={(automationKey) => {
        void navigate({
          to: "/automations",
          search: automationKey ? { automation: automationKey } : {},
          ...(automationKey ? {} : { replace: true }),
        } as never);
      }}
      onOpenTask={(environmentId, taskId) => {
        void navigate({
          to: "/tasks",
          search: { task: `${environmentId}:${taskId}` },
        } as never);
      }}
    />
  );
}
