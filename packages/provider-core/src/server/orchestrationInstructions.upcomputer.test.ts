import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  namesOrchestrationTool,
  orchestrationInstructionsFor,
  registerOrchestrationInstructionsResolver,
  t3AcpPromptWithInstructions,
  t3OrchestrationPrompt,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("T3 orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(
      T3_CODE_ORCHESTRATION_INSTRUCTIONS,
      "Use \`delegate_task\` for another provider's model",
    );
    assert.include(
      T3_CODE_ORCHESTRATION_INSTRUCTIONS,
      "make new top-level threads, only when the user asks",
    );
    assert.include(T3_CODE_ORCHESTRATION_INSTRUCTIONS, "never mean one");
    assert.include(
      T3_CODE_ORCHESTRATION_INSTRUCTIONS,
      "Every new delegate review or re-check is a new",
    );
  });

  it("asks for the provider catalog only to delegate or to report it missing", () => {
    // A chat that only queues a task must not fetch the catalog (perf round 3).
    const sentences = T3_CODE_ORCHESTRATION_INSTRUCTIONS.split(/(?<=\.)\s+/).filter((sentence) =>
      sentence.includes("orchestrator_capabilities"),
    );
    assert.isAbove(sentences.length, 0);
    for (const sentence of sentences) {
      // Upstream's model-options guidance reads the catalog only while choosing a delegate.
      assert.match(
        sentence,
        /Before `delegate_task`|before the first `delegate_task`|Before delegating|before reporting|acp-mcp-call|use `delegate_task`|selected model's descriptors/,
        sentence,
      );
    }
  });

  it("injects prompt fallback only until an MCP-enabled conversation has it", () => {
    const prompt = "Inspect the repository.";
    const base = { prompt, hasDeviceTools: false, deviceInstructionsDelivered: false };
    const injected = t3OrchestrationPrompt({
      ...base,
      hasT3Mcp: true,
      orchestrationDelivered: false,
    });

    assert.include(injected, "<t3_code_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      t3OrchestrationPrompt({ ...base, hasT3Mcp: true, orchestrationDelivered: true }),
      prompt,
    );
    assert.equal(
      t3OrchestrationPrompt({ ...base, hasT3Mcp: false, orchestrationDelivered: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the T3 MCP server is attached", () => {
    assert.equal(t3OrchestrationSystemPrompt(false, false), undefined);
    assert.equal(t3OrchestrationSystemPrompt(true, false), T3_CODE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = t3AcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false },
    });

    assert.include(injected, "Up.computer interaction mode: Default");
    assert.include(injected, "Up.computer browser");
    assert.include(injected, "Up.computer orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = {
      interactionMode: "default",
      hasT3Mcp: true,
      hasDeviceTools: false,
    } as const;

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
      state: { interactionMode: "default", hasT3Mcp: false, hasDeviceTools: false },
    });
    assert.include(withoutMcp, "Up.computer interaction mode: Default");
    assert.notInclude(withoutMcp, "Up.computer browser");
    assert.notInclude(withoutMcp, "Up.computer orchestration");
  });

  it("keeps the ACP browser guidance when the session's agent does not get orchestration", () => {
    const prompt = "Continue.";
    const withBlock = {
      interactionMode: "default",
      hasT3Mcp: true,
      hasDeviceTools: false,
    } as const;
    const withoutBlock = { ...withBlock, orchestrationInstructions: false } as const;

    const injected = t3AcpPromptWithInstructions({ prompt, state: withoutBlock });
    assert.include(injected, "Up.computer browser");
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
