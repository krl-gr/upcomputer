import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { Task } from "@t3tools/tasks-contracts/v1";

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

export function taskMetadataLabel(task: Task): string | null {
  if (!isRecord(task.metadata)) return null;
  const source = typeof task.metadata.source === "string" ? task.metadata.source : null;
  const agentName = typeof task.metadata.agentName === "string" ? task.metadata.agentName : null;
  if (source === "orchestrationProposal" && agentName) return `Orchestration / ${agentName}`;
  return source === "orchestrationProposal" ? "Orchestration" : null;
}
