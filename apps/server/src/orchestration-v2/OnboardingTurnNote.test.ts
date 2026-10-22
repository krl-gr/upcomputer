import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
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

const note = (overrides: Partial<Parameters<typeof onboardingTurnNote<never, never>>[0]> = {}) =>
  onboardingTurnNote({
    instructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    thread: rootThread,
    run: { ordinal: 1 },
    runs: [{ ordinal: 1 }],
    message: personMessage,
    isCommand: false,
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

it.effect("is not sent in a later conversation, answered or not, while the block is pending", () =>
  Effect.gen(function* () {
    // The block stays until the user answers, so only another thread's person message tells.
    assert.strictEqual(yield* note({ personMessagedElsewhere: Effect.succeed(true) }), "");
  }),
);

it.effect("reads other threads only for a turn that would otherwise get the note", () =>
  Effect.gen(function* () {
    const unread = Effect.die("read other threads");
    assert.strictEqual(yield* note({ run: { ordinal: 2 }, personMessagedElsewhere: unread }), "");
    assert.strictEqual(
      yield* note({ instructions: undefined, personMessagedElsewhere: unread }),
      "",
    );
  }),
);

it.effect("is not sent on a later turn", () =>
  Effect.gen(function* () {
    assert.strictEqual(
      yield* note({ run: { ordinal: 2 }, runs: [{ ordinal: 1 }, { ordinal: 2 }] }),
      "",
    );
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
