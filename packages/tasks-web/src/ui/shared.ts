import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  sameTaskStatus,
  taskStatusesFor,
  type Task,
  type TaskWorkflowVersion,
} from "@t3tools/tasks-contracts/v1";

import type { ProjectFaviconProject } from "../../../../apps/web/src/components/ProjectFavicon.tsx";

export interface TasksWebProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly repositoryIdentity?:
    | { readonly canonicalKey: string; readonly rootPath?: string | undefined }
    | null
    | undefined;
  readonly favicon: ProjectFaviconProject;
  /** The sidebar project group within this environment; see `taskProjectsOf`. */
  readonly groupKey: string;
  /** The group member a project picker offers. */
  readonly pickId: ProjectId;
}

/**
 * Each status once, ignoring case and spacing; the spelling of the workflow's
 * standard status wins over a respelling.
 */
export function uniqueStatuses(
  statuses: readonly string[],
  workflowVersion: TaskWorkflowVersion,
): string[] {
  const standard = taskStatusesFor(workflowVersion);
  const unique: string[] = [];
  for (const value of statuses) {
    const status = standard.find((canonical) => sameTaskStatus(canonical, value)) ?? value.trim();
    if (status && !unique.some((seen) => sameTaskStatus(seen, status))) unique.push(status);
  }
  return unique;
}

/**
 * The environments Tasks loads: every environment with a project, plus the
 * primary one, which serves Tasks before its first project exists.
 */
export function tasksEnvironmentIds(
  projects: readonly { readonly environmentId: EnvironmentId }[],
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentId[] {
  const ids = new Set(projects.map(({ environmentId }) => environmentId));
  if (primaryEnvironmentId !== null) ids.add(primaryEnvironmentId);
  return [...ids];
}

export function splitListInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part, index, parts) => part.length > 0 && parts.indexOf(part) === index);
}

/** Identifies a task across environments; the Tasks route's `task` search param. */
export function taskKey(task: {
  readonly environmentId: EnvironmentId;
  readonly id: string;
}): string {
  return `${task.environmentId}:${task.id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function taskMetadataLabel(task: Pick<Task, "metadata">): string | null {
  if (!isRecord(task.metadata)) return null;
  const source = typeof task.metadata.source === "string" ? task.metadata.source : null;
  const agentName = typeof task.metadata.agentName === "string" ? task.metadata.agentName : null;
  if (source === "orchestrationProposal" && agentName) return `Orchestration / ${agentName}`;
  return source === "orchestrationProposal" ? "Orchestration" : null;
}
