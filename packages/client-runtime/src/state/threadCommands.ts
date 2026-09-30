import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";
import type { EnvironmentId, OrchestrationShellSnapshot } from "@upcomputer/contracts";

import { createOptimisticThreadLifecycle } from "./threadLifecycle.ts";
import { canSnooze } from "./threadSettled.ts";
import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";
import {
  type ArchiveThreadInput,
  type AttachThreadContextInput,
  type CreateThreadInput,
  type DeleteThreadInput,
  type ForkThreadContextInput,
  type InterruptThreadTurnInput,
  type LinkThreadProjectsInput,
  type RespondToThreadApprovalInput,
  type RespondToThreadUserInputInput,
  type RemoveThreadContextInput,
  type RevertThreadCheckpointInput,
  type SetThreadInteractionModeInput,
  type SetThreadRuntimeModeInput,
  type SnoozeThreadInput,
  type StartThreadTurnInput,
  type StopThreadSessionInput,
  type UnarchiveThreadInput,
  type UnlinkThreadProjectsInput,
  type UnsnoozeThreadInput,
  type UpdateThreadMetadataInput,
  archiveThread,
  attachThreadContext,
  createThread,
  deleteThread,
  forkThreadContext,
  interruptThreadTurn,
  linkThreadProjects,
  respondToThreadApproval,
  respondToThreadUserInput,
  removeThreadContext,
  revertThreadCheckpoint,
  setThreadInteractionMode,
  setThreadRuntimeMode,
  snoozeThread,
  startThreadTurn,
  stopThreadSession,
  unarchiveThread,
  unlinkThreadProjects,
  unsnoozeThread,
  updateThreadMetadata,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export type {
  ArchiveThreadInput,
  AttachThreadContextInput,
  CreateThreadInput,
  DeleteThreadInput,
  ForkThreadContextInput,
  InterruptThreadTurnInput,
  LinkThreadProjectsInput,
  RespondToThreadApprovalInput,
  RespondToThreadUserInputInput,
  RemoveThreadContextInput,
  RevertThreadCheckpointInput,
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  SnoozeThreadInput,
  StartThreadTurnInput,
  StopThreadSessionInput,
  UnarchiveThreadInput,
  UnlinkThreadProjectsInput,
  UnsnoozeThreadInput,
  UpdateThreadMetadataInput,
} from "../operations/commands.ts";

export function createThreadEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
  snapshotAtom: (environmentId: EnvironmentId) => Atom.Atom<OrchestrationShellSnapshot | null>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      JSON.stringify([environmentId, input.threadId]),
  };
  const commands = {
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:create",
      execute: (input: CreateThreadInput) => createThread(input),
      scheduler,
      concurrency,
    }),
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:delete",
      execute: (input: DeleteThreadInput) => deleteThread(input),
      scheduler,
      concurrency,
    }),
    archive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:archive",
      execute: (input: ArchiveThreadInput) => archiveThread(input),
      scheduler,
      concurrency,
    }),
    unarchive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unarchive",
      execute: (input: UnarchiveThreadInput) => unarchiveThread(input),
      scheduler,
      concurrency,
    }),
    snooze: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:snooze",
      execute: (input: SnoozeThreadInput) => snoozeThread(input),
      scheduler,
      concurrency,
    }),
    unsnooze: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unsnooze",
      execute: (input: UnsnoozeThreadInput) => unsnoozeThread(input),
      scheduler,
      concurrency,
    }),
    updateMetadata: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:update-metadata",
      execute: (input: UpdateThreadMetadataInput) => updateThreadMetadata(input),
      scheduler,
      concurrency,
    }),
    linkProjects: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:link-projects",
      execute: (input: LinkThreadProjectsInput) => linkThreadProjects(input),
      scheduler,
      concurrency,
    }),
    unlinkProjects: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unlink-projects",
      execute: (input: UnlinkThreadProjectsInput) => unlinkThreadProjects(input),
      scheduler,
      concurrency,
    }),
    setRuntimeMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-runtime-mode",
      execute: (input: SetThreadRuntimeModeInput) => setThreadRuntimeMode(input),
      scheduler,
      concurrency,
    }),
    setInteractionMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-interaction-mode",
      execute: (input: SetThreadInteractionModeInput) => setThreadInteractionMode(input),
      scheduler,
      concurrency,
    }),
    attachContext: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:attach-context",
      execute: (input: AttachThreadContextInput) => attachThreadContext(input),
      scheduler,
      concurrency,
    }),
    removeContext: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:remove-context",
      execute: (input: RemoveThreadContextInput) => removeThreadContext(input),
      scheduler,
      concurrency,
    }),
    forkContext: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:fork-context",
      execute: (input: ForkThreadContextInput) => forkThreadContext(input),
      scheduler,
      concurrency,
    }),
    startTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:start-turn",
      execute: (input: StartThreadTurnInput) => startThreadTurn(input),
      scheduler,
      concurrency,
    }),
    interruptTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:interrupt-turn",
      execute: (input: InterruptThreadTurnInput) => interruptThreadTurn(input),
      scheduler,
      concurrency,
    }),
    respondToApproval: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-approval",
      execute: (input: RespondToThreadApprovalInput) => respondToThreadApproval(input),
      scheduler,
      concurrency,
    }),
    respondToUserInput: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-user-input",
      execute: (input: RespondToThreadUserInputInput) => respondToThreadUserInput(input),
      scheduler,
      concurrency,
    }),
    revertCheckpoint: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:revert-checkpoint",
      execute: (input: RevertThreadCheckpointInput) => revertThreadCheckpoint(input),
      scheduler,
      concurrency,
    }),
    stopSession: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:stop-session",
      execute: (input: StopThreadSessionInput) => stopThreadSession(input),
      scheduler,
      concurrency,
    }),
  };
  const optimistic = createOptimisticThreadLifecycle(snapshotAtom);
  return {
    ...commands,
    snapshotAtom: optimistic.snapshotAtom,
    snooze: optimistic.wrap(commands.snooze, (thread, input, now, accepted) =>
      (!accepted && !canSnooze(thread, { now })) ||
      !(Date.parse(input.snoozedUntil) > Date.parse(now))
        ? thread
        : {
            ...thread,
            hasPendingApprovals: false,
            hasPendingUserInput: false,
            snoozedUntil: input.snoozedUntil,
            snoozedAt: thread.snoozedUntil === input.snoozedUntil ? (thread.snoozedAt ?? now) : now,
          },
    ),
    unsnooze: optimistic.wrap(commands.unsnooze, (thread) => ({
      ...thread,
      snoozedUntil: null,
      snoozedAt: null,
    })),
  };
}
