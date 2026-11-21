import type { Task, TaskAgent } from "@t3tools/tasks-contracts/v1";

import type { PersistTaskInput } from "../persistence/TaskRepository.ts";

/**
 * Short replies for the task tools that change a task or an agent. The whole
 * object can run to tens of kilobytes (description, output, instructions) and
 * would fill the caller's context on every edit; task_get, agent_get or
 * `verbose: true` still return it.
 */

/** Rewritten by every write; never news to the caller. */
const TASK_BOOKKEEPING = new Set<string>(["updatedAt", "triggerChangedAt"]);
const FIRST_LINE_LIMIT = 120;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  const trimmed = line.trim();
  return trimmed.length > FIRST_LINE_LIMIT ? `${trimmed.slice(0, FIRST_LINE_LIMIT)}…` : trimmed;
}

/** The task's fields this write changed, including ones the server set (a reopen, a claim). */
export function changedTaskFields(before: Task, after: Task): ReadonlyArray<string> {
  return Object.keys(after).filter(
    (key) =>
      !TASK_BOOKKEEPING.has(key) && !same(before[key as keyof Task], after[key as keyof Task]),
  );
}

/**
 * The task's identity and state, the new values of the short fields it
 * changed, and for description and output only their length. Without
 * `changed` (a new task) both texts are described.
 */
export function shortTaskReply(
  // A dry-run create has no rank yet and may leave defaults unset.
  task: Pick<
    PersistTaskInput,
    | "id"
    | "title"
    | "status"
    | "audience"
    | "kind"
    | "tags"
    | "notBefore"
    | "updatedAt"
    | "description"
    | "output"
  >,
  changed?: ReadonlyArray<string>,
) {
  const shows = (field: string) => changed === undefined || changed.includes(field);
  const shortChanges = Object.fromEntries(
    (changed ?? [])
      .filter((field) => field !== "description" && field !== "output")
      .map((field) => [field, (task as Record<string, unknown>)[field]]),
  );
  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      audience: task.audience,
      kind: task.kind,
      tags: task.tags,
      notBefore: task.notBefore,
      ...shortChanges,
      updatedAt: task.updatedAt,
    },
    ...(changed === undefined ? {} : { changed }),
    ...(shows("description") ? { description: { length: task.description.length } } : {}),
    ...(shows("output") && (changed !== undefined || task.output !== null)
      ? {
          output:
            task.output === null
              ? null
              : { length: task.output.length, firstLine: firstLine(task.output) },
        }
      : {}),
  };
}

/** The agent's fields this write changed, named as agent_update takes them. */
export function changedAgentFields(before: TaskAgent, after: TaskAgent): ReadonlyArray<string> {
  const top = (
    ["projectId", "name", "enabled", "startStatuses", "startTags", "startRunStatuses"] as const
  ).filter((key) => !same(before[key], after[key]));
  const config = Object.keys({ ...before.config, ...after.config }).filter(
    (key) =>
      !same(
        before.config[key as keyof TaskAgent["config"]],
        after.config[key as keyof TaskAgent["config"]],
      ),
  );
  return [...top, ...config];
}

/** The agent without its instructions text, which is only measured. */
export function shortAgentReply(agent: TaskAgent, changed?: ReadonlyArray<string>) {
  const { instructions, ...config } = agent.config;
  return {
    agent: { ...agent, config },
    ...(changed === undefined ? {} : { changed }),
    ...(changed === undefined || changed.includes("instructions")
      ? { instructions: { length: instructions.length } }
      : {}),
  };
}
