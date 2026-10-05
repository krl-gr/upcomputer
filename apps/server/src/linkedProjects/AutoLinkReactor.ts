import { CommandId, type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { forkParked } from "../serverActivation.ts";
import {
  isAutoLinkOpen,
  resolveAutoLinkProjectIds,
  writtenPathsOfTurnItem,
} from "./autoLinkProjects.ts";

/**
 * Links a Scratch thread to the projects its agent writes into, from the
 * completed file-change items of its runs. Best effort: a failure is logged
 * and never affects the run.
 */
export const AutoLinkReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
    const path = yield* Path.Path;
    // The run that made a thread's first auto-links; later runs leave its set alone.
    const autoLinkRunByThread = new Map<ThreadId, string>();
    // One attempt per thread and project, so a refused link is not retried per write.
    const attempted = new Set<string>();

    const autoLink = Effect.fn("AutoLinkReactor.autoLink")(function* (
      item: Parameters<typeof writtenPathsOfTurnItem>[0],
    ) {
      const writtenPaths = writtenPathsOfTurnItem(item);
      if (writtenPaths.length === 0) return;
      const { thread } = yield* threads.getThreadRecords(item.threadId, []);
      if (thread.deletedAt !== null) return;
      const activeProjects = yield* projects.list();
      const scratchRoot = Option.getOrUndefined(yield* folders.scratchRoot);
      const autoLinkRunId = autoLinkRunByThread.get(thread.id);
      if (
        !isAutoLinkOpen({
          thread,
          projects: activeProjects,
          scratchRoot,
          runId: item.runId,
          autoLinkRunId,
        })
      ) {
        return;
      }
      const projectIds: ProjectId[] = resolveAutoLinkProjectIds({
        writtenPaths,
        thread,
        projects: activeProjects,
        scratchRoot,
        path,
      }).filter((projectId) => !attempted.has(`${thread.id}:${projectId}`));
      if (projectIds.length === 0) return;
      for (const projectId of projectIds) attempted.add(`${thread.id}:${projectId}`);
      if (autoLinkRunId === undefined && item.runId !== null) {
        autoLinkRunByThread.set(thread.id, item.runId);
      }
      yield* threads.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make(`linked-projects:auto-link:${item.id}:${projectIds.join(",")}`),
        threadId: thread.id,
        linkProjectIds: projectIds,
      });
    });

    const logFailure = (message: string) => (cause: Cause.Cause<unknown>) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logWarning(message, { cause: Cause.pretty(cause) });

    yield* threads.streamDomainEvents.pipe(
      Stream.runForEach((event) =>
        event.type === "turn-item.updated"
          ? autoLink(event.payload).pipe(
              Effect.catchCause(logFailure("auto-linking a project failed")),
            )
          : Effect.void,
      ),
      // The subscription is live; resubscribe if it ever ends or fails.
      Effect.catchCause(logFailure("the auto-link subscription stopped")),
      Effect.andThen(Effect.sleep("1 second")),
      Effect.forever,
      forkParked,
    );
  }),
);
