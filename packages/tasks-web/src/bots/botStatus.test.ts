import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, RunId } from "@t3tools/contracts";
import { THREAD_STATUS_LABELS } from "../../../../apps/web/src/sidebarThreadRow/ThreadStatusLabel.tsx";
import { botChatStatus, botStatus, botTaskStatus, type BotChatInput } from "./botStatus.ts";

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
  taskThread: Pick<BotChatInput, "runtime"> | null = null,
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
    expect(task("failed", { runtime: runtime("failed", "usage_limit") }).state).toBe("limited");
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
});
