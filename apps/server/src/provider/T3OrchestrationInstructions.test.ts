import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  namesOrchestrationTool,
  orchestrationInstructionsFor,
  registerOrchestrationInstructionsResolver,
  t3AcpPromptWithInstructions,
  t3OrchestrationPromptForFirstRun,
  t3OrchestrationSystemPrompt,
} from "./T3OrchestrationInstructions.ts";

describe("T3 orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "ordinary top-level T3 conversations");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(
      T3_CODE_ORCHESTRATION_INSTRUCTIONS,
      "Do not use `t3_thread_send` on `childThreadId`",
    );
  });

  it("asks for the provider catalog only to delegate or to report it missing", () => {
    // A chat that only queues a task must not fetch the catalog (perf round 3).
    const sentences = T3_CODE_ORCHESTRATION_INSTRUCTIONS.split(/(?<=\.)\s+/).filter((sentence) =>
      sentence.includes("orchestrator_capabilities"),
    );
    assert.isAbove(sentences.length, 0);
    for (const sentence of sentences) {
      assert.match(sentence, /Before delegating|before reporting|acp-mcp-call/, sentence);
    }
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "structured object, never as JSON text");
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = t3OrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasT3Mcp: true,
    });

    assert.include(injected, "<t3_code_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      t3OrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasT3Mcp: true }),
      prompt,
    );
    assert.equal(
      t3OrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasT3Mcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the T3 MCP server is attached", () => {
    assert.equal(t3OrchestrationSystemPrompt(false), undefined);
    assert.equal(t3OrchestrationSystemPrompt(true), T3_CODE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = t3AcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasT3Mcp: true },
    });

    assert.include(injected, "Up.computer interaction mode: Default");
    assert.include(injected, "Up.computer collaborative browser");
    assert.include(injected, "Up.computer orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasT3Mcp: true } as const;

    assert.equal(
      t3AcpPromptWithInstructions({ prompt, state: defaultState, previousState: defaultState }),
      prompt,
    );
    assert.include(
      t3AcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "Up.computer interaction mode: Plan",
    );
    const withoutMcp = t3AcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasT3Mcp: false },
    });
    assert.include(withoutMcp, "Up.computer interaction mode: Default");
    assert.notInclude(withoutMcp, "Up.computer collaborative browser");
    assert.notInclude(withoutMcp, "Up.computer orchestration");
  });

  it("keeps the ACP browser guidance when the session's agent does not get orchestration", () => {
    const prompt = "Continue.";
    const withBlock = { interactionMode: "default", hasT3Mcp: true } as const;
    const withoutBlock = { ...withBlock, orchestrationInstructions: false } as const;

    const injected = t3AcpPromptWithInstructions({ prompt, state: withoutBlock });
    assert.include(injected, "Up.computer collaborative browser");
    assert.notInclude(injected, "Up.computer orchestration");
    assert.equal(
      t3AcpPromptWithInstructions({ prompt, state: withoutBlock, previousState: withoutBlock }),
      prompt,
    );
    assert.include(
      t3AcpPromptWithInstructions({ prompt, state: withBlock, previousState: withoutBlock }),
      "Up.computer orchestration",
    );
  });

  it("recognizes orchestration tools in a configured tool list", () => {
    assert.isTrue(namesOrchestrationTool(["read", "delegate_task"]));
    assert.isTrue(namesOrchestrationTool(["mcp__t3-code__schedule_task"]));
    assert.isTrue(namesOrchestrationTool(["t3_thread_launch"]));
    assert.isFalse(
      namesOrchestrationTool(["read", "bash", "edit", "task_get", "task_update", "task_search"]),
    );
    assert.isFalse(namesOrchestrationTool([]));
  });

  it.effect("keeps the block unless a registered resolver narrows the thread", () =>
    Effect.gen(function* () {
      const chat = ThreadId.make("thread-chat");
      const run = ThreadId.make("thread-task-agent-run");
      const broken = ThreadId.make("thread-resolver-fails");
      assert.isTrue(yield* orchestrationInstructionsFor(run));

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* registerOrchestrationInstructionsResolver((threadId) =>
            threadId === broken
              ? Effect.die("database unavailable")
              : Effect.succeed(threadId === run ? false : undefined),
          );
          assert.isTrue(yield* orchestrationInstructionsFor(chat));
          assert.isFalse(yield* orchestrationInstructionsFor(run));
          assert.isTrue(yield* orchestrationInstructionsFor(broken));
        }),
      );
      assert.isTrue(yield* orchestrationInstructionsFor(run));
    }),
  );
});
