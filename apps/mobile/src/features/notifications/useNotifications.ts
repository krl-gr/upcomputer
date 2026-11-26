import { useServerConfigs } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { canUpdateEnvironmentProvider } from "../settings/environment-maintenance";
import {
  computerOutages,
  providerUpdates,
  type NotificationsEnvironment,
} from "./notificationsModel";

/** What the desktop's bell shows that the phone knows of: provider updates and computer outages. */
export function useNotifications() {
  const { environments } = useWorkspaceState();
  const configs = useServerConfigs();
  const kept: ReadonlyArray<NotificationsEnvironment> = environments
    .filter((environment) => environment.isEnabled)
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.environmentLabel,
      phase: environment.connectionState,
      providers: configs.get(environment.environmentId)?.providers ?? [],
    }));
  return {
    updates: providerUpdates(kept, canUpdateEnvironmentProvider),
    outages: computerOutages(kept),
  };
}

export function useNotificationCount() {
  const { updates, outages } = useNotifications();
  return updates.length + outages.length;
}
