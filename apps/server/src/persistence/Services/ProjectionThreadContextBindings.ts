import {
  IsoDateTime,
  MessageId,
  ProjectId,
  ThreadContextBindingId,
  ThreadContextMode,
  ThreadId,
} from "@upcomputer/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadContextBinding = Schema.Struct({
  bindingId: ThreadContextBindingId,
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  sourceProjectId: Schema.NullOr(ProjectId),
  sourceThreadTitle: Schema.String,
  mode: ThreadContextMode,
  cutoffMessageId: Schema.NullOr(MessageId),
  snapshotText: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadContextBinding = typeof ProjectionThreadContextBinding.Type;

export const GetProjectionThreadContextBindingInput = Schema.Struct({
  bindingId: ThreadContextBindingId,
});
export type GetProjectionThreadContextBindingInput =
  typeof GetProjectionThreadContextBindingInput.Type;

export const ListProjectionThreadContextBindingsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadContextBindingsInput =
  typeof ListProjectionThreadContextBindingsInput.Type;

export const DeleteProjectionThreadContextBindingInput = Schema.Struct({
  bindingId: ThreadContextBindingId,
});
export type DeleteProjectionThreadContextBindingInput =
  typeof DeleteProjectionThreadContextBindingInput.Type;

export const DeleteProjectionThreadContextBindingsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadContextBindingsByThreadInput =
  typeof DeleteProjectionThreadContextBindingsByThreadInput.Type;

export interface ProjectionThreadContextBindingRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadContextBinding,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionThreadContextBindingInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadContextBinding>, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListProjectionThreadContextBindingsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadContextBinding>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectionThreadContextBindingInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadContextBindingsByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadContextBindingRepository extends Context.Service<
  ProjectionThreadContextBindingRepository,
  ProjectionThreadContextBindingRepositoryShape
>()(
  "@upcomputer/server/persistence/Services/ProjectionThreadContextBindings/ProjectionThreadContextBindingRepository",
) {}
