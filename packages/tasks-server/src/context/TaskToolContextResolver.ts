import type {
  ModelSelection,
  OrchestrationProject,
  OrchestrationThread,
  ProjectId,
  ServerProvider,
} from "@upcomputer/contracts";
import { createModelSelection } from "@upcomputer/shared/model";
import { TaskToolContextInput } from "@upcomputer/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  type ExperimentalDynamicToolInvocationContext,
  ProjectionSnapshotQuery,
  ProviderRegistry,
  ServerSettingsService,
} from "../../../../apps/server/src/extensionApi.ts";

export interface TaskProjectCandidate {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
}

export interface TaskProviderCandidate {
  readonly instanceId: string;
  readonly driver: string;
  readonly displayName: string | null;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: string;
  readonly availability: string;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly shortName: string | null;
  }>;
}

export interface TaskResolvedProject {
  readonly source: "explicit-project-id" | "workspace-root" | "current-thread" | "only-project";
  readonly project: TaskProjectCandidate;
}

export interface TaskResolvedModel {
  readonly source:
    | "explicit-model-selection"
    | "model-alias"
    | "project-default"
    | "invocation-context"
    | "current-thread"
    | "server-default"
    | "only-model";
  /** Whether the caller deliberately selected this model rather than receiving contextual fallback. */
  readonly explicit: boolean;
  readonly modelSelection: ModelSelection;
}

export interface TaskToolContextResolution {
  readonly invocation: {
    readonly source: ExperimentalDynamicToolInvocationContext["source"];
    readonly threadId: string | null;
    readonly turnId: string | null;
    readonly interactionMode: string | null;
    readonly runtimeMode: string | null;
    readonly mutationPolicy: "allow" | "deny";
  };
  readonly projects: ReadonlyArray<TaskProjectCandidate>;
  readonly providers: ReadonlyArray<TaskProviderCandidate>;
  readonly resolvedProject: TaskResolvedProject | null;
  readonly resolvedModel: TaskResolvedModel | null;
  readonly warnings: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
}

export interface TaskToolContextResolverShape {
  readonly resolve: (input: {
    readonly args: TaskToolContextInput;
    readonly invocationContext: ExperimentalDynamicToolInvocationContext;
  }) => Effect.Effect<TaskToolContextResolution>;
}

export class TaskToolContextResolver extends Context.Service<
  TaskToolContextResolver,
  TaskToolContextResolverShape
>()("@upcomputer/tasks-server/context/TaskToolContextResolver") {}

interface ModelCandidate {
  readonly provider: ServerProvider;
  readonly model: ServerProvider["models"][number];
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function projectCandidate(project: OrchestrationProject): TaskProjectCandidate {
  return {
    id: project.id,
    title: project.title,
    workspaceRoot: project.workspaceRoot,
    defaultModelSelection: project.defaultModelSelection,
  };
}

function providerCandidate(provider: ServerProvider): TaskProviderCandidate {
  return {
    instanceId: provider.instanceId,
    driver: provider.driver,
    displayName: provider.displayName ?? null,
    enabled: provider.enabled,
    installed: provider.installed,
    status: provider.status,
    availability: provider.availability ?? "available",
    models: provider.models.map((model) => ({
      slug: model.slug,
      name: model.name,
      shortName: model.shortName ?? null,
    })),
  };
}

function eligibleProvider(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.status !== "disabled" &&
    provider.availability !== "unavailable" &&
    provider.models.length > 0
  );
}

function findThread(
  threads: ReadonlyArray<OrchestrationThread>,
  context: ExperimentalDynamicToolInvocationContext,
): OrchestrationThread | undefined {
  return context.threadId === undefined
    ? undefined
    : threads.find((thread) => thread.id === context.threadId && thread.deletedAt === null);
}

function resolveProject(input: {
  readonly args: TaskToolContextInput;
  readonly projects: ReadonlyArray<OrchestrationProject>;
  readonly thread: OrchestrationThread | undefined;
  readonly warnings: string[];
  readonly errors: string[];
}): TaskResolvedProject | null {
  if (input.args.projectId !== undefined) {
    const project = input.projects.find(({ id }) => id === input.args.projectId);
    if (!project) {
      input.errors.push(`Project '${input.args.projectId}' was not found.`);
      return null;
    }
    return { source: "explicit-project-id", project: projectCandidate(project) };
  }
  if (input.args.workspaceRoot !== undefined) {
    const project = input.projects.find(
      ({ workspaceRoot }) => normalize(workspaceRoot) === normalize(input.args.workspaceRoot),
    );
    if (!project) {
      input.errors.push(
        `No active project was found for workspaceRoot '${input.args.workspaceRoot}'.`,
      );
      return null;
    }
    return { source: "workspace-root", project: projectCandidate(project) };
  }
  if (input.thread) {
    const project = input.projects.find(({ id }) => id === input.thread?.projectId);
    if (project) return { source: "current-thread", project: projectCandidate(project) };
    input.warnings.push(`Current thread '${input.thread.id}' has no active project.`);
  }
  if (input.projects.length === 1) {
    return { source: "only-project", project: projectCandidate(input.projects[0]!) };
  }
  input.errors.push(
    input.projects.length === 0
      ? "No active projects are available for task creation."
      : "Project is ambiguous; provide projectId or workspaceRoot.",
  );
  return null;
}

function aliases(candidate: ModelCandidate): ReadonlyArray<string> {
  const { provider, model } = candidate;
  return [
    provider.instanceId,
    provider.driver,
    provider.displayName ?? "",
    model.slug,
    model.name,
    model.shortName ?? "",
    `${provider.instanceId} ${model.slug}`,
    `${provider.driver} ${model.slug}`,
    `${provider.displayName ?? ""} ${model.name}`,
  ].filter((value) => value.trim().length > 0);
}

function aliasMatches(alias: string, candidates: ReadonlyArray<ModelCandidate>) {
  const query = normalize(alias);
  const exact = candidates.filter((candidate) =>
    aliases(candidate).some((value) => normalize(value) === query),
  );
  if (exact.length > 0) return exact;
  const tokens = query.split(/\s+/).filter(Boolean);
  return candidates.filter((candidate) => {
    const text = normalize(aliases(candidate).join(" "));
    return tokens.length > 0 && tokens.every((token) => text.includes(token));
  });
}

function selection(candidate: ModelCandidate): ModelSelection {
  return createModelSelection(candidate.provider.instanceId, candidate.model.slug);
}

function resolveModel(input: {
  readonly args: TaskToolContextInput;
  readonly context: ExperimentalDynamicToolInvocationContext;
  readonly project: TaskResolvedProject | null;
  readonly thread: OrchestrationThread | undefined;
  readonly serverDefault: ModelSelection;
  readonly candidates: ReadonlyArray<ModelCandidate>;
  readonly errors: string[];
}): TaskResolvedModel | null {
  if (input.args.modelSelection) {
    return {
      source: "explicit-model-selection",
      explicit: true,
      modelSelection: input.args.modelSelection,
    };
  }
  if (input.args.modelAlias) {
    const alias = normalize(input.args.modelAlias);
    if (alias === "current") {
      if (input.context.modelSelection) {
        return {
          source: "invocation-context",
          explicit: true,
          modelSelection: input.context.modelSelection,
        };
      }
      if (input.thread) {
        return {
          source: "current-thread",
          explicit: true,
          modelSelection: input.thread.modelSelection,
        };
      }
    }
    if (alias === "project" && input.project?.project.defaultModelSelection) {
      return {
        source: "project-default",
        explicit: true,
        modelSelection: input.project.project.defaultModelSelection,
      };
    }
    const matches = aliasMatches(input.args.modelAlias, input.candidates);
    if (matches.length === 1) {
      return { source: "model-alias", explicit: true, modelSelection: selection(matches[0]!) };
    }
    input.errors.push(
      matches.length > 1
        ? `Model alias '${input.args.modelAlias}' is ambiguous.`
        : `Model alias '${input.args.modelAlias}' did not match an available provider/model.`,
    );
    return null;
  }
  if (input.project?.project.defaultModelSelection) {
    return {
      source: "project-default",
      explicit: false,
      modelSelection: input.project.project.defaultModelSelection,
    };
  }
  if (input.context.modelSelection) {
    return {
      source: "invocation-context",
      explicit: false,
      modelSelection: input.context.modelSelection,
    };
  }
  if (input.thread) {
    return {
      source: "current-thread",
      explicit: false,
      modelSelection: input.thread.modelSelection,
    };
  }
  if (input.serverDefault) {
    return { source: "server-default", explicit: false, modelSelection: input.serverDefault };
  }
  if (input.candidates.length === 1) {
    return {
      source: "only-model",
      explicit: false,
      modelSelection: selection(input.candidates[0]!),
    };
  }
  input.errors.push("Model is ambiguous; provide modelSelection or modelAlias.");
  return null;
}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionSnapshotQuery;
  const providerRegistry = yield* ProviderRegistry;
  const settingsService = yield* ServerSettingsService;

  const resolve: TaskToolContextResolverShape["resolve"] = ({ args, invocationContext }) =>
    Effect.gen(function* () {
      const readModel = yield* projections.getCommandReadModel();
      const providers = yield* providerRegistry.getProviders;
      const settings = yield* settingsService.getSettings;
      const warnings: string[] = [];
      const errors: string[] = [];
      const projects = readModel.projects.filter(({ deletedAt }) => deletedAt === null);
      const thread = findThread(readModel.threads, invocationContext);
      const candidates = providers
        .filter(eligibleProvider)
        .flatMap((provider) => provider.models.map((model) => ({ provider, model })));
      const resolvedProject = resolveProject({ args, projects, thread, warnings, errors });
      const resolvedModel = resolveModel({
        args,
        context: invocationContext,
        project: resolvedProject,
        thread,
        serverDefault: settings.textGenerationModelSelection,
        candidates,
        errors,
      });
      if (resolvedModel && !resolvedModel.explicit) {
        warnings.push(
          `The resolved model is a contextual fallback (${resolvedModel.source}), not a suitability recommendation. Pass modelSelection or modelAlias explicitly when creating an agent.`,
        );
      }
      return {
        invocation: {
          source: invocationContext.source,
          threadId: invocationContext.threadId ?? null,
          turnId: invocationContext.turnId ?? null,
          interactionMode: invocationContext.interactionMode ?? null,
          runtimeMode: invocationContext.runtimeMode ?? null,
          mutationPolicy: invocationContext.mutationPolicy ?? "deny",
        },
        projects: projects.map(projectCandidate),
        providers: providers.map(providerCandidate),
        resolvedProject,
        resolvedModel,
        warnings,
        errors,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed({
          invocation: {
            source: invocationContext.source,
            threadId: invocationContext.threadId ?? null,
            turnId: invocationContext.turnId ?? null,
            interactionMode: invocationContext.interactionMode ?? null,
            runtimeMode: invocationContext.runtimeMode ?? null,
            mutationPolicy: invocationContext.mutationPolicy ?? "deny",
          },
          projects: [],
          providers: [],
          resolvedProject: null,
          resolvedModel: null,
          warnings: [],
          errors: [
            cause instanceof Error && cause.message.trim()
              ? cause.message
              : "Task context could not be loaded.",
          ],
        }),
      ),
    );
  return { resolve } satisfies TaskToolContextResolverShape;
});

export const TaskToolContextResolverLive = Layer.effect(TaskToolContextResolver, make);
