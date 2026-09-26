import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import * as CodexSchema from "./schema.ts";

const isServerCollabAgentTool = Schema.is(CodexSchema.ServerNotification__CollabAgentTool);
const isResumeCollabAgentTool = Schema.is(CodexSchema.V2ThreadResumeResponse__CollabAgentTool);
const isResumeCollabStatus = Schema.is(
  CodexSchema.V2ThreadResumeResponse__CollabAgentToolCallStatus,
);
const isCompletedItem = Schema.is(CodexSchema.V2ItemCompletedNotification);
const isAccount = Schema.is(CodexSchema.V2GetAccountResponse);
const isThreadReadResponse = Schema.is(CodexSchema.V2ThreadReadResponse);
const isThreadResumeResponse = Schema.is(CodexSchema.V2ThreadResumeResponse);
const isThreadRollbackResponse = Schema.is(CodexSchema.V2ThreadRollbackResponse);

it("accepts Codex 0.150+ multi-agent values in current thread fixtures", () => {
  for (const schema of [
    CodexSchema.ServerNotification__SubAgentActivityKind,
    CodexSchema.V2ItemStartedNotification__SubAgentActivityKind,
    CodexSchema.V2ItemCompletedNotification__SubAgentActivityKind,
    CodexSchema.V2ThreadReadResponse__SubAgentActivityKind,
    CodexSchema.V2ThreadResumeResponse__SubAgentActivityKind,
  ]) {
    assert.equal(Schema.is(schema)("completed"), true);
  }

  for (const tool of ["sendMessage", "followupTask", "interruptAgent", "listAgents"]) {
    assert.equal(isServerCollabAgentTool(tool), true);
    assert.equal(isResumeCollabAgentTool(tool), true);
  }
  assert.equal(isResumeCollabStatus("interrupted"), true);

  const completedItem = {
    completedAtMs: 1,
    threadId: "root-thread",
    turnId: "turn-1",
    item: {
      agentsStates: {},
      id: "item-1",
      receiverThreadIds: ["child-thread"],
      senderThreadId: "root-thread",
      status: "interrupted",
      tool: "followupTask",
      type: "collabAgentToolCall",
    },
  };
  assert.equal(isCompletedItem(completedItem), true);
});

it("keeps Codex 0.147 plans and accepts Codex 0.150+ account plans", () => {
  for (const planType of [
    "plus",
    "self_serve_business_prolite",
    "ent26",
    "enterprise_cbp_automation",
    "edu_plus",
    "edu_pro",
  ]) {
    assert.equal(
      isAccount({
        account: { email: "fixture@example.invalid", planType, type: "chatgpt" },
        requiresOpenaiAuth: true,
      }),
      true,
    );
  }
});

it("accepts Codex rate limit errors for thread responses", () => {
  const failedThread = {
    cliVersion: "0.150.0",
    createdAt: 0,
    cwd: "/tmp/project",
    ephemeral: false,
    id: "thread-1",
    modelProvider: "openai",
    preview: "",
    sessionId: "session-1",
    source: "cli",
    status: { type: "idle" },
    turns: [
      {
        error: {
          codexErrorInfo: "rateLimitExceeded",
          message: "Rate limit exceeded",
        },
        id: "turn-1",
        items: [],
        status: "failed",
      },
    ],
    updatedAt: 0,
  };
  assert.equal(isThreadReadResponse({ thread: failedThread }), true);
  assert.equal(
    isThreadResumeResponse({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      cwd: "/tmp/project",
      model: "gpt-5.6-sol",
      modelProvider: "openai",
      sandbox: { type: "dangerFullAccess" },
      thread: failedThread,
    }),
    true,
  );
  assert.equal(isThreadRollbackResponse({ thread: failedThread }), true);
});
