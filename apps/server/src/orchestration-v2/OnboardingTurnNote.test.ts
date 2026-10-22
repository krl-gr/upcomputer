import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
  ScheduledTaskId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";

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

const note = (overrides: Partial<Parameters<typeof onboardingTurnNote>[0]> = {}) =>
  onboardingTurnNote({
    instructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    thread: rootThread,
    run: { ordinal: 1 },
    runs: [{ ordinal: 1 }],
    message: personMessage,
    isCommand: false,
    ...overrides,
  });

it("is sent with a person's first message while the onboarding block is pending", () => {
  assert.include(note(), "one-time onboarding in your instructions is still pending");
  assert.include(note({ message: { createdBy: "user", creationSource: "mobile" } }), "onboarding");
});

it("is not sent on a later turn", () => {
  assert.strictEqual(note({ run: { ordinal: 2 }, runs: [{ ordinal: 1 }, { ordinal: 2 }] }), "");
});

it("stops once setup removed the onboarding block", () => {
  const withoutBlock = DEFAULT_CUSTOM_INSTRUCTIONS.slice(
    0,
    DEFAULT_CUSTOM_INSTRUCTIONS.indexOf("<!-- onboarding"),
  );
  assert.strictEqual(note({ instructions: withoutBlock }), "");
  assert.strictEqual(note({ instructions: undefined }), "");
});

it("is not sent to a task-agent run", () => {
  assert.strictEqual(note({ message: { createdBy: "agent", creationSource: "server" } }), "");
});

it("is not sent to a delegated child thread", () => {
  const parentThreadId = ThreadId.make("thread:parent");
  assert.strictEqual(
    note({
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
    note({ message: { createdBy: "user", creationSource: "web", senderThreadId: parentThreadId } }),
    "",
  );
});

it("is not sent to a scheduled task or with a slash command", () => {
  // A scheduled task keeps its creator's user/web origin.
  assert.strictEqual(
    note({
      message: {
        createdBy: "user",
        creationSource: "web",
        scheduledTaskId: ScheduledTaskId.make("scheduled-task:daily"),
      },
    }),
    "",
  );
  assert.strictEqual(note({ isCommand: true }), "");
});
