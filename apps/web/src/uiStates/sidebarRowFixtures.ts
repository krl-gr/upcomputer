import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { presentThreadShell, type EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { TaskAgentId, type Bot, type TaskRunCount } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";

import type { SidebarThreadSummary } from "../types";

/*
 * Data for the sidebar-rows sheet, in the shapes the server sends: threads are wire
 * shells run through the client's own `presentThreadShell`, so every status comes from
 * the app's derivation, not from a hand-set label.
 */

export const ENVIRONMENT_ID = EnvironmentId.make("environment-ui-states");
const CODEX = ProviderInstanceId.make("codex");
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
const NOW = Date.now();
export const at = (offsetMs: number) => DateTime.makeUnsafe(NOW + offsetMs);
export const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
export const NOW_ISO = iso(0);

const SCRATCH_ROOT = "/Users/me/.upcomputer/scratch";

function project(
  id: string,
  title: string,
  icon: NonNullable<EnvironmentProject["projectIcon"]> | null,
  workspaceRoot = `/Users/me/code/${id}`,
): EnvironmentProject {
  return {
    id: ProjectId.make(id),
    environmentId: ENVIRONMENT_ID,
    title,
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    projectIcon: icon,
    scripts: [],
    createdAt: iso(-30 * 24 * HOUR),
    updatedAt: iso(-30 * 24 * HOUR),
  };
}

export const PROJECT = project("upcomputer", "UpComputer", {
  kind: "monogram",
  text: "UC",
  color: "blue",
});
const SITE = project("site", "Marketing site", { kind: "monogram", text: "MS", color: "green" });
const DOCS = project("docs", "Docs", { kind: "monogram", text: "D", color: "orange" });
export const SCRATCH = project("scratch", "No project", null, SCRATCH_ROOT);
/** A project without an icon of its own: it shows its raster favicon (see icon-sizes). */
export const FAVICON_PROJECT = project("favicon", "Raster favicon", null);
/** What `useProjects` returns while the sheet renders. */
export const PROJECTS: ReadonlyArray<EnvironmentProject> = [PROJECT, SITE, DOCS, SCRATCH];
export const LINKED_PROJECT_IDS = { site: SITE.id, docs: DOCS.id };
export const SCRATCH_WORKSPACE_ROOT = SCRATCH_ROOT;

/**
 * A thread as the sidebar gets it. The base finished three hours ago and was read since,
 * so it shows no status; `wire` sets what the server would send for each state.
 */
export function threadShell(
  id: string,
  title: string,
  wire: Partial<OrchestrationV2ThreadShell> = {},
): SidebarThreadSummary {
  const threadId = ThreadId.make(id);
  return presentThreadShell(ENVIRONMENT_ID, {
    id: threadId,
    projectId: PROJECT.id,
    title,
    providerInstanceId: CODEX,
    modelSelection: { instanceId: CODEX, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: RunId.make(`${id}-run`),
    latestRunCompletedAt: at(-3 * HOUR),
    activeRunId: null,
    status: "completed",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: at(-3 * HOUR),
    hasActionableProposedPlan: false,
    itemCount: 12,
    visibleItemCount: 12,
    createdAt: at(-26 * HOUR),
    updatedAt: at(-3 * HOUR),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: at(-HOUR),
    deletedAt: null,
    ...wire,
  });
}

export const threadKeyOf = (thread: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

const running = (id: string): Partial<OrchestrationV2ThreadShell> => ({
  status: "running",
  activeRunId: RunId.make(`${id}-run`),
  latestRunCompletedAt: null,
  latestUserMessageAt: at(-4 * MINUTE),
  updatedAt: at(-MINUTE),
});

const pendingRequest = (
  kind: NonNullable<OrchestrationV2ThreadShell["pendingRuntimeRequest"]>["kind"],
) => ({
  id: RuntimeRequestId.make(`request-${kind}`),
  kind,
  createdAt: at(-2 * MINUTE),
});

/** The server data for each status the compact row names, by the row's own label. */
export const STATUS_WIRE = {
  none: {},
  Working: running("working"),
  Waiting: { ...running("waiting"), blockedOnThreadWait: true },
  "Pending Approval": {
    ...running("approval"),
    status: "waiting",
    pendingRuntimeRequest: pendingRequest("command"),
  },
  "Awaiting Input": {
    ...running("input"),
    status: "waiting",
    pendingRuntimeRequest: pendingRequest("user_input"),
  },
  "Guest Request": { pendingGuestMessageCount: 1 },
  Completed: { latestRunCompletedAt: at(-12 * MINUTE), latestUserMessageAt: at(-20 * MINUTE) },
  Failed: {
    status: "failed",
    latestRunCompletedAt: at(-40 * MINUTE),
    lastError: "The provider process exited.",
    lastErrorClass: "provider_error",
  },
  Limited: {
    status: "failed",
    latestRunCompletedAt: at(-40 * MINUTE),
    lastError: "Usage limit reached.",
    lastErrorClass: "usage_limit",
  },
} satisfies Record<string, Partial<OrchestrationV2ThreadShell>>;

export const titleRegeneration = (): OrchestrationV2ThreadShell["titleRegeneration"] => ({
  requestId: CommandId.make("regenerate-title"),
  startedAt: at(-MINUTE),
});

/** Task run counts the fake Tasks client answers, by thread id. */
export const RUN_COUNTS: Readonly<Record<string, ReadonlyArray<TaskRunCount>>> = {
  "thread-runs": [
    { status: "running", count: 1 },
    { status: "completed", count: 2 },
  ],
  "bot-runs-chat": [
    { status: "running", count: 2 },
    { status: "completed", count: 1 },
  ],
};

export function bot(id: string, name: string): Bot {
  return {
    agent: {
      id: TaskAgentId.make(id),
      projectId: null,
      name,
      enabled: true,
      startStatuses: [],
      startTags: [],
      startRunStatuses: [],
      config: {
        role: "Bot",
        modelSelection: { instanceId: CODEX, model: "gpt-5.4" },
        instructions: "Help with the project.",
      },
      createdAt: iso(-7 * 24 * HOUR),
      updatedAt: iso(-7 * 24 * HOUR),
    },
    appearance: null,
    threadId: ThreadId.make(`${id}-chat`),
    projectId: SCRATCH.id,
    allowedProjectIds: [],
  };
}

/** Each bot chat's server data, by chat thread id; a bot without one is idle. */
export const BOT_CHAT_WIRE: Readonly<Record<string, Partial<OrchestrationV2ThreadShell>>> = {
  "bot-working-chat": running("bot-working"),
  "bot-attention-chat": {
    ...running("bot-attention"),
    status: "waiting",
    pendingRuntimeRequest: pendingRequest("user_input"),
  },
};
