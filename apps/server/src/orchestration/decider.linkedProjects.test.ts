import {
  CommandId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@upcomputer/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const home = ProjectId.make("project-home");
const docs = ProjectId.make("project-docs");
const infra = ProjectId.make("project-infra");
const gone = ProjectId.make("project-gone");
const threadId = ThreadId.make("thread-linked");

let commandCounter = 0;
const nextCommandId = () => CommandId.make(`cmd-linked-${++commandCounter}`);

const apply = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  Effect.gen(function* () {
    const decided = yield* decideOrchestrationCommand({ command, readModel });
    const events = Array.isArray(decided) ? decided : [decided];
    let next = readModel;
    for (const event of events) {
      next = yield* projectEvent(next, { ...event, sequence: next.snapshotSequence + 1 });
    }
    return { readModel: next, events };
  });

const seed = Effect.gen(function* () {
  let readModel = createEmptyReadModel(now);
  for (const projectId of [home, docs, infra, gone]) {
    ({ readModel } = yield* apply(readModel, {
      type: "project.create",
      commandId: nextCommandId(),
      projectId,
      title: projectId,
      workspaceRoot: `/work/${projectId}`,
      createdAt: now,
    }));
  }
  ({ readModel } = yield* apply(readModel, {
    type: "project.delete",
    commandId: nextCommandId(),
    projectId: gone,
  }));
  ({ readModel } = yield* apply(readModel, {
    type: "thread.create",
    commandId: nextCommandId(),
    threadId,
    projectId: home,
    title: "Linked",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: now,
  }));
  return readModel;
});

const threadOf = (readModel: OrchestrationReadModel) =>
  readModel.threads.find((thread) => thread.id === threadId)!;

it.layer(NodeServices.layer)("decider linked projects", (it) => {
  it.effect("starts threads and projects without links", () =>
    Effect.gen(function* () {
      const readModel = yield* seed;
      assert.deepEqual(threadOf(readModel).linkedProjectIds, []);
      assert.deepEqual(
        readModel.projects.find((project) => project.id === home)?.linkedProjectIds,
        [],
      );
    }),
  );

  it.effect("links projects through thread.meta-updated with the full set, deduped", () =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const linked = yield* apply(seeded, {
        type: "thread.project.link",
        commandId: nextCommandId(),
        threadId,
        projectIds: [docs, home, docs],
      });
      assert.equal(linked.events.length, 1);
      assert.equal(linked.events[0]?.type, "thread.meta-updated");
      assert.deepEqual(linked.events[0]?.payload, {
        threadId,
        linkedProjectIds: [docs],
        updatedAt: linked.events[0]?.occurredAt,
      });
      assert.deepEqual(threadOf(linked.readModel).linkedProjectIds, [docs]);

      const more = yield* apply(linked.readModel, {
        type: "thread.project.link",
        commandId: nextCommandId(),
        threadId,
        projectIds: [infra, docs],
      });
      assert.deepEqual(threadOf(more.readModel).linkedProjectIds, [docs, infra]);

      const unlinked = yield* apply(more.readModel, {
        type: "thread.project.unlink",
        commandId: nextCommandId(),
        threadId,
        projectIds: [docs, gone],
      });
      assert.deepEqual(threadOf(unlinked.readModel).linkedProjectIds, [infra]);
    }),
  );

  it.effect("re-emits an unchanged set without moving updatedAt", () =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const before = threadOf(seeded).updatedAt;
      const result = yield* apply(seeded, {
        type: "thread.project.link",
        commandId: nextCommandId(),
        threadId,
        projectIds: [home],
      });
      assert.equal(result.events.length, 1);
      assert.deepEqual(threadOf(result.readModel).linkedProjectIds, []);
      assert.equal(threadOf(result.readModel).updatedAt, before);
    }),
  );

  it.effect("rejects links to unknown or deleted projects", () =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      for (const projectId of [gone, ProjectId.make("project-missing")]) {
        const error = yield* Effect.flip(
          decideOrchestrationCommand({
            command: {
              type: "thread.project.link",
              commandId: nextCommandId(),
              threadId,
              projectIds: [projectId],
            },
            readModel: seeded,
          }),
        );
        assert.equal(error._tag, "OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("drops links to projects deleted since, on the next write", () =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const linked = yield* apply(seeded, {
        type: "thread.project.link",
        commandId: nextCommandId(),
        threadId,
        projectIds: [docs],
      });
      const deleted = yield* apply(linked.readModel, {
        type: "project.delete",
        commandId: nextCommandId(),
        projectId: docs,
      });
      const relinked = yield* apply(deleted.readModel, {
        type: "thread.project.link",
        commandId: nextCommandId(),
        threadId,
        projectIds: [infra],
      });
      assert.deepEqual(threadOf(relinked.readModel).linkedProjectIds, [infra]);
    }),
  );

  it.effect("replaces project tags on project.meta.update, validated and without self", () =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const tagged = yield* apply(seeded, {
        type: "project.meta.update",
        commandId: nextCommandId(),
        projectId: home,
        linkedProjectIds: [docs, home, infra, docs],
      });
      assert.deepEqual(
        (tagged.events[0]?.payload as { linkedProjectIds?: unknown } | undefined)?.linkedProjectIds,
        [docs, infra],
      );
      assert.deepEqual(
        tagged.readModel.projects.find((project) => project.id === home)?.linkedProjectIds,
        [docs, infra],
      );

      // Other metadata updates leave tags alone.
      const renamed = yield* apply(tagged.readModel, {
        type: "project.meta.update",
        commandId: nextCommandId(),
        projectId: home,
        title: "Home",
      });
      assert.deepEqual(
        renamed.readModel.projects.find((project) => project.id === home)?.linkedProjectIds,
        [docs, infra],
      );

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "project.meta.update",
            commandId: nextCommandId(),
            projectId: home,
            linkedProjectIds: [gone],
          },
          readModel: renamed.readModel,
        }),
      );
      assert.equal(error._tag, "OrchestrationCommandInvariantError");
    }),
  );
});
