import * as NodeAssert from "node:assert/strict";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  THREAD_CONTEXT_MIN_USER_PROMPT_BUDGET,
  ThreadContextBindingId,
  ThreadId,
  type OrchestrationMessage,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@upcomputer/contracts";
import { describe, it } from "vite-plus/test";

import {
  buildSnapshotThreadContextBinding,
  materializeThreadContextBindings,
  validateThreadContextBinding,
} from "./threadContext.ts";

const createdAt = "2026-01-01T00:00:00.000Z";

function message(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  minute?: number;
}): OrchestrationMessage {
  const iso = `2026-01-01T00:${String(input.minute ?? 0).padStart(2, "0")}:00.000Z`;
  return {
    id: MessageId.make(input.id),
    turnId: null,
    role: input.role,
    text: input.text,
    streaming: input.streaming ?? false,
    createdAt: iso,
    updatedAt: iso,
  };
}

function thread(input: {
  id: string;
  title?: string;
  messages?: OrchestrationMessage[];
  contextBindings?: OrchestrationThread["contextBindings"];
  deletedAt?: string | null;
}): OrchestrationThread {
  return {
    id: ThreadId.make(input.id),
    projectId: ProjectId.make("project-1"),
    title: input.title ?? input.id,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    deletedAt: input.deletedAt ?? null,
    messages: input.messages ?? [],
    proposedPlans: [],
    contextBindings: input.contextBindings ?? [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function readModel(threads: OrchestrationThread[]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [],
    threads,
    updatedAt: createdAt,
  };
}

describe("threadContext", () => {
  it("snapshot captures completed user and assistant messages only", () => {
    const targetThread = thread({ id: "target" });
    const sourceThread = thread({
      id: "source",
      messages: [
        message({ id: "user-1", role: "user", text: "completed user", minute: 1 }),
        message({ id: "assistant-1", role: "assistant", text: "completed assistant", minute: 2 }),
        message({
          id: "assistant-streaming",
          role: "assistant",
          text: "streaming assistant",
          streaming: true,
          minute: 3,
        }),
      ],
    });

    const binding = buildSnapshotThreadContextBinding({
      bindingId: ThreadContextBindingId.make("ctx-1"),
      targetThread,
      sourceThread,
      createdAt,
    });

    NodeAssert.notStrictEqual(typeof binding, "string");
    if (typeof binding === "string") return;
    NodeAssert.match(binding.snapshotText ?? "", /USER:\ncompleted user/);
    NodeAssert.match(binding.snapshotText ?? "", /ASSISTANT:\ncompleted assistant/);
    NodeAssert.doesNotMatch(binding.snapshotText ?? "", /streaming assistant/);
  });

  it("snapshot cutoff must point at a completed assistant message", () => {
    const targetThread = thread({ id: "target" });
    const sourceThread = thread({
      id: "source",
      messages: [
        message({ id: "user-1", role: "user", text: "ask", minute: 1 }),
        message({ id: "assistant-1", role: "assistant", text: "answer", minute: 2 }),
        message({ id: "user-2", role: "user", text: "next ask", minute: 3 }),
      ],
    });

    const rejected = buildSnapshotThreadContextBinding({
      bindingId: ThreadContextBindingId.make("ctx-1"),
      targetThread,
      sourceThread,
      cutoffMessageId: MessageId.make("user-1"),
      createdAt,
    });
    NodeAssert.equal(typeof rejected, "string");

    const accepted = buildSnapshotThreadContextBinding({
      bindingId: ThreadContextBindingId.make("ctx-2"),
      targetThread,
      sourceThread,
      cutoffMessageId: MessageId.make("assistant-1"),
      createdAt,
    });
    NodeAssert.notStrictEqual(typeof accepted, "string");
    if (typeof accepted === "string") return;
    NodeAssert.match(accepted.snapshotText ?? "", /ASSISTANT:\nanswer/);
    NodeAssert.doesNotMatch(accepted.snapshotText ?? "", /next ask/);
  });

  it("rejects snapshot bindings when the source has no completed context messages", () => {
    const targetThread = thread({ id: "target" });
    const sourceThread = thread({
      id: "source",
      messages: [
        message({
          id: "assistant-streaming",
          role: "assistant",
          text: "still streaming",
          streaming: true,
          minute: 1,
        }),
      ],
    });

    const rejected = buildSnapshotThreadContextBinding({
      bindingId: ThreadContextBindingId.make("ctx-empty"),
      targetThread,
      sourceThread,
      createdAt,
    });

    NodeAssert.equal(rejected, "Source thread has no completed messages to attach.");
  });

  it("materializes stored snapshot context without needing source messages", () => {
    const sourceThread = thread({
      id: "source",
      title: "Source",
      messages: [
        message({ id: "user-1", role: "user", text: "first ask", minute: 1 }),
        message({ id: "assistant-1", role: "assistant", text: "first answer", minute: 2 }),
      ],
    });
    const targetThread = thread({ id: "target" });
    const binding = buildSnapshotThreadContextBinding({
      bindingId: ThreadContextBindingId.make("ctx-snapshot"),
      targetThread,
      sourceThread,
      createdAt,
    });
    NodeAssert.notStrictEqual(typeof binding, "string");
    if (typeof binding === "string") return;

    const materialized = materializeThreadContextBindings({
      readModel: readModel([{ ...targetThread, contextBindings: [binding] }]),
      targetThread: { ...targetThread, contextBindings: [binding] },
      userPromptLength: 10,
    });

    NodeAssert.equal(materialized.blocks.length, 1);
    NodeAssert.match(materialized.blocks[0]?.text ?? "", /USER:\nfirst ask/);
    NodeAssert.match(materialized.blocks[0]?.text ?? "", /ASSISTANT:\nfirst answer/);
  });

  it("does not leak full snapshot text when the remaining context budget is tiny", () => {
    const targetThread = thread({
      id: "target",
      contextBindings: [
        {
          id: ThreadContextBindingId.make("ctx-small-budget"),
          targetThreadId: ThreadId.make("target"),
          sourceThreadId: ThreadId.make("source"),
          sourceProjectId: ProjectId.make("project-1"),
          sourceThreadTitle: "Source",
          mode: "snapshot",
          snapshotText: "secret transcript that must not fit",
          createdAt,
          updatedAt: createdAt,
        },
      ],
    });
    const materialized = materializeThreadContextBindings({
      readModel: readModel([targetThread]),
      targetThread,
      userPromptLength:
        PROVIDER_SEND_TURN_MAX_INPUT_CHARS - THREAD_CONTEXT_MIN_USER_PROMPT_BUDGET - 4,
    });

    NodeAssert.equal(materialized.blocks.length, 1);
    NodeAssert.equal(materialized.blocks[0]?.text.length, 4);
    NodeAssert.doesNotMatch(materialized.blocks[0]?.text ?? "", /secret transcript/);
  });

  it("rejects self-binding and cycles", () => {
    const a = thread({
      id: "a",
      messages: [message({ id: "a-user", role: "user", text: "a context", minute: 1 })],
    });
    const c = thread({
      id: "c",
      messages: [message({ id: "c-user", role: "user", text: "c context", minute: 1 })],
    });
    const bBinding = buildSnapshotThreadContextBinding({
      bindingId: ThreadContextBindingId.make("ctx-b-c"),
      targetThread: thread({ id: "b" }),
      sourceThread: c,
      createdAt,
    });
    NodeAssert.notStrictEqual(typeof bBinding, "string");
    if (typeof bBinding === "string") return;
    const cBinding = buildSnapshotThreadContextBinding({
      bindingId: ThreadContextBindingId.make("ctx-c-a"),
      targetThread: c,
      sourceThread: a,
      createdAt,
    });
    NodeAssert.notStrictEqual(typeof cBinding, "string");
    if (typeof cBinding === "string") return;
    const b = thread({ id: "b", contextBindings: [bBinding] });
    const cWithBinding = thread({ id: "c", contextBindings: [cBinding] });

    NodeAssert.equal(
      validateThreadContextBinding({
        readModel: readModel([a, b]),
        targetThreadId: a.id,
        sourceThreadId: a.id,
      }).ok,
      false,
    );
    NodeAssert.equal(
      validateThreadContextBinding({
        readModel: readModel([a, b, cWithBinding]),
        targetThreadId: a.id,
        sourceThreadId: b.id,
      }).ok,
      false,
    );
  });
});
