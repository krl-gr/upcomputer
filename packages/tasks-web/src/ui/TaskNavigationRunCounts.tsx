/* oxlint-disable t3code/no-native-title-tooltip -- ported V1 Tasks UI; moves to Tooltip with the product UI phase. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TaskRunCount } from "@t3tools/tasks-contracts/v1";

import { useServerConfigs } from "../../../../apps/web/src/state/entities.ts";
import { useEnvironments } from "../../../../apps/web/src/state/environments.ts";
import {
  readTasksWebAccess,
  readTasksWebClient,
  useTasksWebAccessRevision,
} from "../environmentApi.ts";
import type { TasksWebRpcClient } from "../rpc/index.ts";
import { environmentRunCountsStore } from "../state/environmentRunCounts.ts";
import { taskRunPresentation } from "./taskRunPresentation.ts";

const WORKING_CLASS_NAME = taskRunPresentation("running", false)?.className ?? "";

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

/** One number in the Working color, or nothing when no run is working. */
export function WorkingRunCount({ counts }: { counts: readonly TaskRunCount[] }) {
  const working = counts.reduce(
    (sum, count) => (count.status === "running" ? sum + count.count : sum),
    0,
  );
  if (working <= 0) return null;
  const summary = `Running task agents · ${working}`;
  return (
    <span
      className={`tabular-nums opacity-80 ${WORKING_CLASS_NAME}`}
      aria-label={summary}
      title={`${summary}\nAll connected environments`}
    >
      {working}
    </span>
  );
}

/** Runs working now across every connected environment; history stays on thread rows. */
export function TaskNavigationRunCounts() {
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const accessRevision = useTasksWebAccessRevision();
  const clients = useMemo(() => {
    const result: Array<{ environmentId: EnvironmentId; client: TasksWebRpcClient }> = [];
    for (const { environmentId } of environments) {
      if (!serverConfigs.has(environmentId)) continue;
      if (readTasksWebAccess(environmentId).canReadTasks) {
        result.push({ environmentId, client: readTasksWebClient(environmentId) });
      }
    }
    return result;
    // Environments are checked once connected; access changes re-run this.
  }, [environments, serverConfigs, accessRevision]);
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
  const counts = useMemo(() => [...byEnvironment.values()].flat(), [byEnvironment]);
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
      <WorkingRunCount counts={counts} />
    </>
  );
}
