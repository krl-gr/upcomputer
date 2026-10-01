import {
  TaskAgentId,
  TaskError,
  TaskId,
  type OrchestrationProposalAgent,
  type OrchestrationProposalApplyInput,
  type OrchestrationProposalApplyResult,
  type OrchestrationProposalTask,
  type Task,
  type TaskAgent,
} from "@upcomputer/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../../../../apps/server/src/extensionApi.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { ProposalStore, type StoredOrchestrationProposal } from "./ProposalStore.ts";

export interface ProposalApplicationServiceShape {
  readonly apply: (
    input: OrchestrationProposalApplyInput,
  ) => Effect.Effect<OrchestrationProposalApplyResult, TaskError>;
}

export class ProposalApplicationService extends Context.Service<
  ProposalApplicationService,
  ProposalApplicationServiceShape
>()("@upcomputer/tasks-server/proposals/ProposalApplicationService") {}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function agentId(planId: string, index: number, name: string) {
  return TaskAgentId.make(`task-agent:proposal:${planId}:agent:${index}:${slug(name)}`);
}

function taskId(planId: string, index: number, title: string) {
  return TaskId.make(`task:proposal:${planId}:task:${index}:${slug(title)}`);
}

function unique(values: ReadonlyArray<string> | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function matchesAgent(task: OrchestrationProposalTask, agent: OrchestrationProposalAgent) {
  return task.agentName?.trim().toLowerCase() === agent.name.trim().toLowerCase();
}

function agentTags(
  agent: OrchestrationProposalAgent,
  tasks: ReadonlyArray<OrchestrationProposalTask>,
): string[] {
  const explicit = unique(agent.startTags);
  if (explicit.length > 0) return explicit;
  const fromTasks = unique(
    tasks.flatMap((task) => (matchesAgent(task, agent) ? (task.tags ?? []) : [])),
  );
  return fromTasks.length > 0 ? fromTasks : [`agent:${slug(agent.name)}`];
}

function taskTags(
  task: OrchestrationProposalTask,
  agentStartTags: ReadonlyMap<string, ReadonlyArray<string>>,
): string[] {
  const explicit = unique(task.tags);
  const configured = task.agentName
    ? (agentStartTags.get(task.agentName.trim().toLowerCase()) ?? [])
    : [];
  return configured.some((tag) => explicit.includes(tag))
    ? explicit
    : unique([...explicit, ...configured]);
}

function instructions(agent: OrchestrationProposalAgent): string {
  const sections = [
    agent.instructions?.trim(),
    agent.trigger?.trim() ? `Trigger: ${agent.trigger.trim()}` : undefined,
    agent.responsibilities?.length
      ? `Responsibilities:\n${agent.responsibilities.map((item) => `- ${item.trim()}`).join("\n")}`
      : undefined,
  ].filter((section): section is string => Boolean(section));
  return sections.length > 0
    ? sections.join("\n\n")
    : `Work only on tasks assigned to ${agent.name}. Update status and append findings.`;
}

function toTaskError(message: string, cause?: unknown) {
  return new TaskError({ message, ...(cause === undefined ? {} : { cause }) });
}

const make = Effect.gen(function* () {
  const proposals = yield* ProposalStore;
  const tasks = yield* TaskRepository;
  const taskAgents = yield* TaskAgentService;
  const projections = yield* ProjectionSnapshotQuery;

  const loadApplied = (stored: StoredOrchestrationProposal) =>
    Effect.gen(function* () {
      const agents = yield* Effect.forEach(stored.agentIds, (id) =>
        tasks.getAgentById({ id: TaskAgentId.make(id) }).pipe(Effect.map(Option.getOrUndefined)),
      );
      const appliedTasks = yield* Effect.forEach(stored.taskIds, (id) =>
        tasks.getById({ id: TaskId.make(id) }).pipe(Effect.map(Option.getOrUndefined)),
      );
      return {
        agents: agents.filter((agent): agent is TaskAgent => agent !== undefined),
        tasks: appliedTasks.filter((task): task is Task => task !== undefined),
      } satisfies OrchestrationProposalApplyResult;
    });

  const apply: ProposalApplicationServiceShape["apply"] = (input) =>
    Effect.gen(function* () {
      const timestamp = DateTime.formatIso(yield* DateTime.now);

      const result = yield* tasks.withChangeTransaction(
        Effect.gen(function* () {
          const existing = yield* proposals.get(input);
          if (Option.isNone(existing)) {
            return yield* Effect.fail(toTaskError("Orchestration proposal not found."));
          }
          if (existing.value.applicationState === "applied") {
            return { result: yield* loadApplied(existing.value), changed: false } as const;
          }
          if (existing.value.applicationState === "applying") {
            return yield* Effect.fail(
              toTaskError("Orchestration proposal is already being applied."),
            );
          }

          const claimed = yield* proposals.claimApplication({ ...input, updatedAt: timestamp });
          const thread = yield* projections.getThreadDetailById(input.threadId);
          if (Option.isNone(thread)) {
            return yield* Effect.fail(toTaskError("Thread not found for orchestration proposal."));
          }
          const proposalAgents = claimed.proposal.agents ?? [];
          const proposalTasks = claimed.proposal.tasks ?? [];
          if (proposalAgents.length === 0 && proposalTasks.length === 0) {
            return yield* Effect.fail(
              toTaskError("Orchestration proposal does not contain applyable agents or tasks."),
            );
          }

          const startTags = new Map(
            proposalAgents.map((agent) => [
              agent.name.trim().toLowerCase(),
              agentTags(agent, proposalTasks),
            ]),
          );
          const savedAgents = yield* Effect.forEach(
            proposalAgents,
            (agent, index) =>
              tasks.upsertAgent({
                id: agentId(input.planId, index, agent.name),
                projectId: thread.value.projectId,
                name: agent.name,
                enabled: true,
                startStatuses:
                  unique(agent.startStatuses).length > 0 ? unique(agent.startStatuses) : ["new"],
                startTags: startTags.get(agent.name.trim().toLowerCase()) ?? [],
                startRunStatuses: [],
                config: {
                  role: agent.role ?? agent.name,
                  modelSelection: thread.value.modelSelection,
                  runtimeMode: thread.value.runtimeMode,
                  interactionMode: "default",
                  ...(agent.tools ? { tools: agent.tools } : {}),
                  ...(agent.skills ? { skills: agent.skills } : {}),
                  instructions: instructions(agent),
                },
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            { concurrency: 1 },
          );
          const savedTasks = yield* Effect.forEach(
            proposalTasks,
            (task, index) =>
              tasks.upsert({
                id: taskId(input.planId, index, task.title),
                projectId: thread.value.projectId,
                title: task.title,
                description: task.description ?? "",
                output: null,
                status: task.status ?? "new",
                priority: null,
                createdBy: "orchestrator",
                assigneeAgentRunId: null,
                sourceThreadId: thread.value.id,
                sourceRunId: null,
                metadata: {
                  source: "orchestrationProposal",
                  proposalId: input.planId,
                  agentName: task.agentName ?? null,
                },
                tags: taskTags(task, startTags),
                createdAt: timestamp,
                updatedAt: timestamp,
                closedAt: null,
              }),
            { concurrency: 1 },
          );
          yield* proposals.completeApplication({
            ...input,
            agentIds: savedAgents.map(({ id }) => id),
            taskIds: savedTasks.map(({ id }) => id),
            appliedAt: timestamp,
          });
          return {
            result: { agents: savedAgents, tasks: savedTasks },
            changed: true,
          } as const;
        }),
      );

      if (result.changed) {
        yield* Effect.forEach(
          result.result.agents,
          (agent) => taskAgents.scheduleAgentChanged({ agent, reason: "upserted" }),
          { discard: true, concurrency: 1 },
        );
        yield* Effect.forEach(
          result.result.tasks,
          (task) => taskAgents.scheduleTaskChanged({ task, reason: "created" }),
          { discard: true, concurrency: 1 },
        );
      }
      return result.result;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof TaskError ? cause : toTaskError("Failed to apply proposal.", cause),
      ),
    );

  return { apply } satisfies ProposalApplicationServiceShape;
});

export const ProposalApplicationServiceLive = Layer.effect(ProposalApplicationService, make);
