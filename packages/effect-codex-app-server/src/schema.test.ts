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
const isThreadForkResponse = Schema.is(CodexSchema.V2ThreadForkResponse);
const isTurnCompletedNotification = Schema.is(CodexSchema.V2TurnCompletedNotification);
const decodeThreadResumeResponse = Schema.decodeUnknownSync(CodexSchema.V2ThreadResumeResponse);

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

it("accepts account plan slugs newer than the pinned protocol", () => {
  for (const planType of [
    "plus",
    "self_serve_business_prolite",
    "ent26",
    "enterprise_cbp_automation",
    "edu_plus",
    "edu_pro",
    "promax",
    "some_future_plan",
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
    projectId: null,
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
});

it("accepts Codex misalignment policy errors for thread responses", () => {
  const failedThread = {
    cliVersion: "0.150.0",
    createdAt: 0,
    cwd: "/tmp/project",
    ephemeral: false,
    id: "thread-1",
    modelProvider: "openai",
    preview: "",
    projectId: null,
    sessionId: "session-1",
    source: "cli",
    status: { type: "idle" },
    turns: [
      {
        error: {
          codexErrorInfo: "misalignmentPolicyViolation",
          message: "Misalignment policy violation",
        },
        id: "turn-1",
        items: [],
        status: "failed",
      },
    ],
    updatedAt: 0,
  };
  const resumeLikeResponse = {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: "/tmp/project",
    model: "gpt-5.6-sol",
    modelProvider: "openai",
    sandbox: { type: "dangerFullAccess" },
    thread: failedThread,
  };
  assert.equal(isThreadReadResponse({ thread: failedThread }), true);
  assert.equal(isThreadResumeResponse(resumeLikeResponse), true);
  assert.equal(isThreadForkResponse(resumeLikeResponse), true);
  const decodedResume = decodeThreadResumeResponse(resumeLikeResponse);
  assert.equal(decodedResume.thread.turns[0]?.error?.codexErrorInfo, "misalignmentPolicyViolation");
  assert.equal(
    isTurnCompletedNotification({
      threadId: "thread-1",
      turn: {
        error: {
          codexErrorInfo: "misalignmentPolicyViolation",
          message: "Misalignment policy violation",
        },
        id: "turn-1",
        items: [],
        status: "failed",
      },
    }),
    true,
  );
});
