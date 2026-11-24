import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { onboardingTurnNote } from "./OnboardingTurnNote.ts";

const rootThread: Pick<OrchestrationV2AppThread, "lineage"> = {
  lineage: {
    parentThreadId: null,
    relationshipToParent: null,
    rootThreadId: ThreadId.make("thread:chat"),
  },
};
const personMessage: Pick<
  OrchestrationV2ConversationMessage,
  "createdBy" | "creationSource" | "scheduledTaskId" | "senderThreadId"
> = { createdBy: "user", creationSource: "web" };

const claude = ProviderInstanceId.make("claudeAgent");
const openCode = ProviderInstanceId.make("opencode");
const freeModel = "opencode/glm-5.3-flash-free";
const turn = (ordinal: number, providerInstanceId = claude, model = "claude-sonnet-5-5") => ({
  ordinal,
  providerInstanceId,
  modelSelection: { instanceId: providerInstanceId, model },
});
const freeTurn = (ordinal: number) => turn(ordinal, openCode, freeModel);

const note = (overrides: Partial<Parameters<typeof onboardingTurnNote<never, never>>[0]> = {}) =>
  onboardingTurnNote({
    instructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    thread: rootThread,
    run: turn(1),
    runs: [turn(1)],
    message: personMessage,
    isCommand: false,
    freeAgentSetupActive: false,
    isFreeAgentRun: (run) =>
      run.providerInstanceId === openCode && run.modelSelection.model === freeModel,
    personMessagedElsewhere: Effect.succeed(false),
    ...overrides,
  });

it.effect("is sent with a person's first message in their first conversation", () =>
  Effect.gen(function* () {
    assert.include(
      yield* note(),
      "UpComputer onboarding note: this is the user's first conversation",
    );
    assert.include(
      yield* note({ message: { createdBy: "user", creationSource: "mobile" } }),
      "onboarding",
    );
  }),
);

it.effect(
  "forbids the offer in a later conversation, answered or not, while the block is pending",
  () =>
    Effect.gen(function* () {
      // The block stays until the user answers, so only another thread's person message tells.
      const later = yield* note({ personMessagedElsewhere: Effect.succeed(true) });
      assert.include(later, "this is not the user's first conversation");
      assert.include(later, "Do not make the onboarding offer");
    }),
);

it.effect("reads other threads only for a turn that would otherwise get the note", () =>
  Effect.gen(function* () {
    const unread = Effect.die("read other threads");
    assert.strictEqual(yield* note({ run: turn(2), personMessagedElsewhere: unread }), "");
    assert.strictEqual(
      yield* note({ instructions: undefined, personMessagedElsewhere: unread }),
      "",
    );
  }),
);

it.effect("is not sent on a later turn", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* note({ run: turn(2), runs: [turn(1), turn(2)] }), "");
  }),
);

it.effect("stops once setup removed the onboarding block", () =>
  Effect.gen(function* () {
    const withoutBlock = DEFAULT_CUSTOM_INSTRUCTIONS.slice(
      0,
      DEFAULT_CUSTOM_INSTRUCTIONS.indexOf("<!-- onboarding"),
    );
    assert.strictEqual(yield* note({ instructions: withoutBlock }), "");
    assert.strictEqual(yield* note({ instructions: undefined }), "");
  }),
);

it.effect("is not sent to a task-agent run", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      yield* note({ message: { createdBy: "agent", creationSource: "server" } }),
      "",
    );
  }),
);

it.effect("is not sent to a delegated child thread", () =>
  Effect.gen(function* () {
    const parentThreadId = ThreadId.make("thread:parent");
    assert.strictEqual(
      yield* note({
        thread: {
          lineage: {
            parentThreadId,
            relationshipToParent: "subagent",
            rootThreadId: parentThreadId,
          },
        },
        message: { createdBy: "agent", creationSource: "mcp", senderThreadId: parentThreadId },
      }),
      "",
    );
    // create_threads starts a root thread whose first message another thread sent.
    assert.strictEqual(
      yield* note({
        message: { createdBy: "user", creationSource: "web", senderThreadId: parentThreadId },
      }),
      "",
    );
  }),
);

it.effect("is not sent to a scheduled task or with a slash command", () =>
  Effect.gen(function* () {
    // A scheduled task keeps its creator's user/web origin.
    assert.strictEqual(
      yield* note({
        message: {
          createdBy: "user",
          creationSource: "web",
          scheduledTaskId: ScheduledTaskId.make("scheduled-task:daily"),
        },
      }),
      "",
    );
    assert.strictEqual(yield* note({ isCommand: true }), "");
  }),
);

it.effect("waits for a real agent while the free agent is the only one that works", () =>
  Effect.gen(function* () {
    const unread = Effect.die("read other threads");
    assert.strictEqual(
      yield* note({
        freeAgentSetupActive: true,
        run: freeTurn(1),
        runs: [freeTurn(1)],
        personMessagedElsewhere: unread,
      }),
      "",
    );
    // A real agent's turn gets it even while the registry still says setup.
    assert.include(yield* note({ freeAgentSetupActive: true }), "user's first conversation");
    // So does the user's own OpenCode on a paid model or their own keys.
    const ownOpenCode = turn(1, openCode, "anthropic/claude-sonnet-5-5");
    assert.include(
      yield* note({ freeAgentSetupActive: true, run: ownOpenCode, runs: [ownOpenCode] }),
      "user's first conversation",
    );
  }),
);

it.effect("comes in the setup chat's first turn after switching to a real agent", () =>
  Effect.gen(function* () {
    assert.include(
      yield* note({
        run: turn(4),
        runs: [freeTurn(1), freeTurn(2), freeTurn(3), turn(4)],
      }),
      "user's first conversation",
    );
    // The next real turn in that chat is a later turn.
    assert.strictEqual(yield* note({ run: turn(5), runs: [freeTurn(1), turn(4), turn(5)] }), "");
  }),
);

it.effect("is never sent on a later free-agent turn once another agent works", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* note({ run: freeTurn(3), runs: [freeTurn(1), freeTurn(3)] }), "");
    // A free-agent chat started after setup is a first conversation like any other.
    assert.include(
      yield* note({ run: freeTurn(1), runs: [freeTurn(1)] }),
      "user's first conversation",
    );
  }),
);
