import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { EnvironmentId } from "@upcomputer/contracts";
import type { TaskRunCount } from "@upcomputer/tasks-contracts/v1";

import {
  readEnvironmentExtensionApi,
  readEnvironmentProductManifest,
} from "../../../../apps/web/src/extensionApi.ts";
import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";
import { useEnvironments } from "../../../../apps/web/src/state/environments.ts";
import { TASKS_WEB_ENVIRONMENT_API } from "../environmentApi.ts";
import { resolveTasksWebAccess, type TasksWebRpcClient } from "../rpc/index.ts";
import { environmentRunCountsStore } from "../state/environmentRunCounts.ts";
import { groupTaskRunCounts } from "./taskRunPresentation.ts";

/** Renders nothing; reports one environment's counts to the summing parent. */
function EnvironmentCounts({
  environmentId,
  client,
  onCounts,
}: {
  environmentId: EnvironmentId;
  client: TasksWebRpcClient;
  onCounts: (environmentId: EnvironmentId, counts: readonly TaskRunCount[] | null) => void;
}) {
  const store = environmentRunCountsStore(client);
  const counts = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => onCounts(environmentId, counts), [counts, environmentId, onCounts]);
  useEffect(() => () => onCounts(environmentId, null), [environmentId, onCounts]);
  return null;
}

/** Run counts over every task of every connected environment, colored like thread rows. */
export function TaskNavigationRunCounts() {
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const clients = useMemo(() => {
    const result: Array<{ environmentId: EnvironmentId; client: TasksWebRpcClient }> = [];
    for (const { environmentId } of environments) {
      const client = readEnvironmentExtensionApi(environmentId, TASKS_WEB_ENVIRONMENT_API);
      const manifest = readEnvironmentProductManifest(environmentId);
      const access = resolveTasksWebAccess({
        manifest,
        metadataStatus: manifest === undefined ? "loading" : "ready",
      });
      if (client && access.canReadTasks) result.push({ environmentId, client });
    }
    return result;
    // Clients and manifests appear as server configs arrive.
  }, [environments, serverConfigs]);
  const [byEnvironment, setByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, readonly TaskRunCount[]>
  >(new Map());
  const onCounts = useCallback(
    (environmentId: EnvironmentId, counts: readonly TaskRunCount[] | null) =>
      setByEnvironment((current) => {
        if (counts === null ? !current.has(environmentId) : current.get(environmentId) === counts) {
          return current;
        }
        const next = new Map(current);
        if (counts === null) next.delete(environmentId);
        else next.set(environmentId, counts);
        return next;
      }),
    [],
  );
  const groups = useMemo(
    () => groupTaskRunCounts([...byEnvironment.values()].flat()),
    [byEnvironment],
  );
  const summary = `Task runs · ${groups.map((group) => `${group.label}: ${group.count}`).join(" · ")}`;
  return (
    <>
      {clients.map(({ environmentId, client }) => (
        <EnvironmentCounts
          key={environmentId}
          environmentId={environmentId}
          client={client}
          onCounts={onCounts}
        />
      ))}
      {groups.length > 0 ? (
        <span
          className="inline-flex items-center gap-1 opacity-80"
          aria-label={summary}
          title={`${summary}\nAll projects, including previous attempts`}
        >
          {groups.map((group) => (
            <span key={group.label} className={group.className}>
              {group.count}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
}
