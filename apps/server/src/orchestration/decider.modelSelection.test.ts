import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@upcomputer/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const CODEX_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
};
const CLAUDE_SELECTION = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-4-6",
};

function makeReadModel(started: boolean): OrchestrationReadModel {
  const message = {
    id: MessageId.make("message-existing"),
    role: "user",
    text: "Existing conversation",
    turnId: null,
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as OrchestrationThread["messages"][number];

  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: CODEX_SELECTION,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        deletedAt: null,
        messages: started ? [message] : [],
        proposedPlans: [],
        contextBindings: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("thread provider instance invariant", (it) => {
  it.effect("rejects metadata updates that switch a started thread to another instance", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-meta-provider-switch"),
          threadId: ThreadId.make("thread-1"),
          modelSelection: CLAUDE_SELECTION,
        },
        readModel: makeReadModel(true),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("cannot switch to 'claudeAgent'");
        expect(error.detail).toContain("after the conversation has started");
      }
    }),
  );

  it.effect("rejects turn starts that switch a started thread to another instance", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-provider-switch"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-next"),
            role: "user",
            text: "Continue elsewhere",
            attachments: [],
          },
          modelSelection: CLAUDE_SELECTION,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel(true),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      if (error._tag === "OrchestrationCommandInvariantError") {
        expect(error.detail).toContain("cannot switch to 'claudeAgent'");
      }
    }),
  );

  it.effect("allows metadata provider instance changes before the thread starts", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-meta-provider-first"),
          threadId: ThreadId.make("thread-1"),
          modelSelection: CLAUDE_SELECTION,
        },
        readModel: makeReadModel(false),
      });
      const events = Array.isArray(event) ? event : [event];

      expect(events[0]?.type).toBe("thread.meta-updated");
      if (events[0]?.type === "thread.meta-updated") {
        expect(events[0].payload.modelSelection).toEqual(CLAUDE_SELECTION);
      }
    }),
  );

  it.effect("allows a provider instance choice on the first turn", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-provider-first"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-first"),
            role: "user",
            text: "Start with Claude",
            attachments: [],
          },
          modelSelection: CLAUDE_SELECTION,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel(false),
      });
      const events = Array.isArray(result) ? result : [result];
      const turnStart = events.find((event) => event.type === "thread.turn-start-requested");

      expect(turnStart?.type).toBe("thread.turn-start-requested");
      if (turnStart?.type === "thread.turn-start-requested") {
        expect(turnStart.payload.modelSelection).toEqual(CLAUDE_SELECTION);
      }
    }),
  );

  it.effect("allows model updates within the bound provider instance", () =>
    Effect.gen(function* () {
      const nextSelection = {
        instanceId: CODEX_SELECTION.instanceId,
        model: "gpt-5.5",
      };
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-meta-model-switch"),
          threadId: ThreadId.make("thread-1"),
          modelSelection: nextSelection,
        },
        readModel: makeReadModel(true),
      });
      const events = Array.isArray(event) ? event : [event];

      expect(events[0]?.type).toBe("thread.meta-updated");
      if (events[0]?.type === "thread.meta-updated") {
        expect(events[0].payload.modelSelection).toEqual(nextSelection);
      }
    }),
  );
});
