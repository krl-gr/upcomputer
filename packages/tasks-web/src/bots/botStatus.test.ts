import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, RunId } from "@t3tools/contracts";
import { THREAD_STATUS_LABELS } from "../../../../apps/web/src/sidebarThreadRow/ThreadStatusLabel.tsx";
import {
  botChatStatus,
  botStatus,
  botTaskRunRequest,
  botTaskRunRequestStatus,
  botTaskStatus,
  type BotChatInput,
} from "./botStatus.ts";

const runtime = (
  status: NonNullable<BotChatInput["runtime"]>["status"],
  lastErrorClass: "usage_limit" | "provider_error" | null = null,
) => ({
  status,
  activeRunId: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: lastErrorClass ? "boom" : null,
  lastErrorClass,
  updatedAt: "2026-10-20T10:00:00.000Z",
});

const idleChat: BotChatInput = {
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
  hasActionableProposedPlan: false,
  interactionMode: "default",
  latestRun: null,
  runtime: null,
  lastVisitedAt: "2026-10-20T09:00:00.000Z",
};

const replied: BotChatInput = {
  ...idleChat,
  runtime: runtime("completed"),
  latestRun: {
    runId: RunId.make("run-1"),
    status: "completed",
    requestedAt: "2026-10-20T09:30:00.000Z",
    startedAt: "2026-10-20T09:30:00.000Z",
    completedAt: "2026-10-20T10:00:00.000Z",
    assistantMessageId: null,
  },
};

const chat = (input: BotChatInput) => botStatus(botChatStatus(input), null);
const task = (
  runStatus: string | undefined,
  taskThread: Pick<
    BotChatInput,
    "runtime" | "hasPendingApprovals" | "hasPendingUserInput"
  > | null = null,
) => botStatus(null, botTaskStatus(runStatus, taskThread));

describe("bot status", () => {
  it("shows no status while the bot is idle", () => {
    expect(chat(idleChat)).toEqual({ state: "idle", label: null, detail: null });
    expect(botStatus(botChatStatus(null), botTaskStatus(undefined, null)).state).toBe("idle");
    expect(task("completed").state).toBe("idle");
  });

  it("uses the thread labels word for word", () => {
    const working = chat({ ...idleChat, runtime: runtime("running") });
    expect(working.state).toBe("working");
    expect(working.label).toEqual({ kind: "working", ...THREAD_STATUS_LABELS.working });
    expect(chat({ ...idleChat, runtime: runtime("starting") }).state).toBe("working");
    expect(chat({ ...idleChat, hasPendingApprovals: true }).label?.label).toBe("Pending Approval");
    expect(chat({ ...idleChat, hasPendingUserInput: true }).label?.label).toBe("Awaiting Input");
  });

  it("asks for the user on an approval, a question, or a plan to review", () => {
    expect(chat({ ...idleChat, hasPendingApprovals: true }).state).toBe("attention");
    expect(chat({ ...idleChat, hasPendingUserInput: true }).state).toBe("attention");
    const plan = chat({ ...replied, interactionMode: "plan", hasActionableProposedPlan: true });
    expect(plan.state).toBe("attention");
    expect(plan.label?.kind).toBe("input");
  });

  it("shows a reply as done until the chat is opened", () => {
    const unread = chat(replied);
    expect(unread.state).toBe("done");
    expect(unread.label?.label).toBe(THREAD_STATUS_LABELS.done.label);
    expect(chat({ ...replied, lastVisitedAt: "2026-10-20T10:05:00.000Z" }).state).toBe("idle");
  });

  it("separates a failed turn from a provider limit", () => {
    expect(chat({ ...idleChat, runtime: runtime("failed", "provider_error") }).state).toBe(
      "failed",
    );
    const limited = chat({ ...idleChat, runtime: runtime("failed", "usage_limit") });
    expect(limited.state).toBe("limited");
    expect(limited.label?.label).toBe("Limited");
  });

  it("waits while its background task runs, and reports how the task ended", () => {
    expect(task("running").state).toBe("waiting");
    expect(task("running").label?.label).toBe("Waiting");
    expect(task("finalizing:result").state).toBe("waiting");
    const blocked = task("blocked");
    expect(blocked.state).toBe("attention");
    expect(blocked.label?.label).toBe("Awaiting Input");
    expect(blocked.detail).toBe("Background task is blocked");
    expect(task("failed").state).toBe("failed");
    expect(task("interrupted").state).toBe("failed");
    expect(task("failed", { ...idleChat, runtime: runtime("failed", "usage_limit") }).state).toBe(
      "limited",
    );
  });

  it("shows a background run's approval or question until it is answered", () => {
    const waiting = { ...idleChat, runtime: runtime("running") };
    const approval = task("running", { ...waiting, hasPendingApprovals: true });
    expect(approval.state).toBe("attention");
    expect(approval.label?.label).toBe("Pending Approval");
    expect(approval.detail).toBe("Background task needs approval");
    expect(task("running", { ...waiting, hasPendingUserInput: true }).label?.label).toBe(
      "Awaiting Input",
    );
    // Opening the chat later than the request does not hide it.
    expect(
      botTaskStatus(
        "running",
        { ...waiting, hasPendingApprovals: true },
        { completedAt: null, lastVisitedAt: "2026-10-20T11:00:00.000Z" },
      )?.kind,
    ).toBe("approval");
  });

  it("stops reporting how the task ended once the chat is opened after it", () => {
    const ended = { completedAt: "2026-10-20T10:00:00.000Z" };
    for (const status of ["failed", "interrupted", "blocked"]) {
      const before = botTaskStatus(status, null, {
        ...ended,
        lastVisitedAt: "2026-10-20T09:59:00.000Z",
      });
      expect(before).not.toBeNull();
      expect(
        botTaskStatus(status, null, { ...ended, lastVisitedAt: "2026-10-20T10:01:00.000Z" }),
      ).toBeNull();
    }
    // A server that does not say when the run ended keeps the status, as before.
    expect(
      botTaskStatus("failed", null, { lastVisitedAt: "2026-10-20T10:01:00.000Z" }),
    ).not.toBeNull();
    expect(
      botTaskStatus("running", null, { ...ended, lastVisitedAt: "2026-10-20T10:01:00.000Z" }),
    ).not.toBeNull();
  });

  it("orders the chat and the task as thread statuses are ordered", () => {
    const background = botTaskStatus("running", null);
    expect(
      botStatus(botChatStatus({ ...idleChat, runtime: runtime("running") }), background).state,
    ).toBe("working");
    expect(botStatus(botChatStatus(replied), background).state).toBe("waiting");
    expect(
      botStatus(botChatStatus({ ...idleChat, hasPendingUserInput: true }), background).state,
    ).toBe("attention");
    expect(botStatus(botChatStatus(replied), botTaskStatus("failed", null)).state).toBe("failed");
    expect(botStatus(botChatStatus(replied), botTaskStatus("completed", null)).state).toBe("done");
  });

  it("shows Pending Approval while another task agent's run from the chat waits on it", () => {
    const waiting = { hasPendingApprovals: true, hasPendingUserInput: false, runtime: null };
    const asking = { hasPendingApprovals: false, hasPendingUserInput: true };
    const working = { hasPendingApprovals: false, hasPendingUserInput: false };
    expect(botTaskRunRequest([])).toBeNull();
    expect(botTaskRunRequest([working, null])).toBeNull();
    expect(botTaskRunRequest([asking, waiting])).toBe("approval");
    expect(botTaskRunRequest([working, asking])).toBe("input");
    // The bot chat is busy waiting on the task, as in the QA run; the approval still wins.
    const status = botStatus(
      botChatStatus({ ...idleChat, runtime: runtime("running") }),
      null,
      botTaskRunRequestStatus(botTaskRunRequest([working, waiting])),
    );
    expect(status.label).toEqual({ kind: "approval", ...THREAD_STATUS_LABELS.approval });
    expect(status.detail).toBe("A task from this chat needs approval");
    // The bot's own run says it first when both ask.
    expect(
      botStatus(
        null,
        botTaskStatus("running", waiting),
        botTaskRunRequestStatus(botTaskRunRequest([waiting])),
      ).detail,
    ).toBe("Background task needs approval");
  });
});
