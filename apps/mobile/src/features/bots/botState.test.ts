import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { EMPTY_BOT_LIST } from "@t3tools/tasks-client/bots/botList";
import { TaskAgentId, type Bot } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it } from "vite-plus/test";

import {
  botMentionMessage,
  botSectionOf,
  botStatusOf,
  matchMentionBots,
  shownBots,
  type BotSection,
} from "./botState";

const here = EnvironmentId.make("env-here");
const there = EnvironmentId.make("env-there");
const app = ProjectId.make("project-app");
const site = ProjectId.make("project-site");

const bot = (name: string, patch: Partial<Bot> = {}) =>
  ({
    agent: { id: TaskAgentId.make(`bot-${name.toLowerCase()}`), name },
    threadId: ThreadId.make(`chat-${name.toLowerCase()}`),
    projectId: app,
    allowedProjectIds: [],
    ...patch,
  }) as unknown as Bot;

const shell = (patch: Partial<EnvironmentThreadShell>) =>
  ({
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    runtime: null,
    latestRun: null,
    interactionMode: "default",
    hasActionableProposedPlan: false,
    lastVisitedAt: "2026-11-26T09:00:00.000Z",
    ...patch,
  }) as EnvironmentThreadShell;

const nova = bot("Nova");
const release = bot("Release helper", { projectId: site });

describe("Bots section", () => {
  it("shows a computer's list once loaded, and nothing for one without bots", () => {
    expect(botSectionOf(here, "loading", EMPTY_BOT_LIST)).toEqual({
      environmentId: here,
      state: "loading",
    });
    expect(botSectionOf(here, "unavailable", EMPTY_BOT_LIST)).toBeNull();
    expect(botSectionOf(here, "enabled", { ...EMPTY_BOT_LIST, unsupported: true })).toBeNull();
    expect(botSectionOf(here, "enabled", { ...EMPTY_BOT_LIST, failed: true })).toEqual({
      environmentId: here,
      state: "failed",
    });
    // A list that loaded once keeps showing through a later failure.
    expect(
      botSectionOf(here, "enabled", {
        bots: [nova],
        loaded: true,
        failed: true,
        unsupported: false,
      }),
    ).toEqual({ environmentId: here, state: "ready", bots: [nova] });
  });

  it("follows the Chats project filter and search", () => {
    const sections: BotSection[] = [
      { environmentId: here, state: "ready", bots: [nova, release] },
      { environmentId: there, state: "ready", bots: [bot("Nova", { projectId: site })] },
      { environmentId: EnvironmentId.make("env-loading"), state: "loading" },
    ];
    const names = (input: Parameters<typeof shownBots>[1]) =>
      shownBots(sections, input).map((entry) => `${entry.environmentId}:${entry.bot.agent.name}`);
    expect(names({ projectRefs: null, query: "" })).toEqual([
      "env-here:Nova",
      "env-here:Release helper",
      "env-there:Nova",
    ]);
    expect(names({ projectRefs: [{ environmentId: here, projectId: site }], query: "" })).toEqual([
      "env-here:Release helper",
    ]);
    expect(names({ projectRefs: null, query: " nov " })).toEqual([
      "env-here:Nova",
      "env-there:Nova",
    ]);
  });
});

describe("bot status", () => {
  const shells = (entries: Record<string, EnvironmentThreadShell>) => (threadId: ThreadId) =>
    entries[threadId] ?? null;

  it("reads Completed until the chat is opened after the reply", () => {
    const replied = shell({
      latestRun: { status: "completed", completedAt: "2026-11-26T10:00:00.000Z" } as never,
    });
    expect(botStatusOf(nova, shells({ [nova.threadId]: replied }))).toEqual({
      kind: "done",
      detail: null,
    });
    const opened = { ...replied, lastVisitedAt: "2026-11-26T10:05:00.000Z" };
    expect(botStatusOf(nova, shells({ [nova.threadId]: opened }))).toBeNull();
  });

  it("asks for the user before showing work, wherever the request comes from", () => {
    const working = shell({ runtime: { status: "running" } as never });
    const asking = shell({ hasPendingApprovals: true });
    const busy = bot("Nova", {
      latestTaskRun: { threadId: ThreadId.make("run-1"), status: "running" },
      activeTaskRunThreadIds: [ThreadId.make("run-2")],
    });
    expect(botStatusOf(busy, shells({ [busy.threadId]: working }))).toEqual({
      kind: "working",
      detail: null,
    });
    expect(botStatusOf(busy, shells({ [busy.threadId]: working, ["run-2"]: asking }))).toEqual({
      kind: "approval",
      detail: "chatTaskApproval",
    });
    // Idle chat, its own background task still running.
    expect(botStatusOf(busy, shells({}))).toEqual({ kind: "waiting", detail: "taskWaiting" });
  });

  it("names a plan waiting for review", () => {
    const plan = shell({ interactionMode: "plan", hasActionableProposedPlan: true });
    expect(botStatusOf(nova, shells({ [nova.threadId]: plan }))).toEqual({
      kind: "input",
      detail: "planReview",
    });
  });
});

describe("bot mentions", () => {
  const thread = ThreadId.make("thread-chat");
  const route = (draft: string, hasAttachments = false, threadId = thread) =>
    botMentionMessage({ draft, hasAttachments, bots: [nova, release], threadId });

  it("offers every bot but the chat's own", () => {
    expect(matchMentionBots([nova, release], thread, "")).toEqual([nova, release]);
    expect(matchMentionBots([nova, release], nova.threadId, "")).toEqual([release]);
    expect(matchMentionBots([nova, release], thread, "rel")).toEqual([release]);
  });

  it("sends a message that opens with one bot's name to that bot, as text only", () => {
    expect(route("@Nova, check the build")).toEqual({
      kind: "send",
      bot: nova,
      text: "check the build",
    });
    expect(route('@"Release helper" ship it')).toMatchObject({ kind: "send", bot: release });
    expect(route("Ask @Nova later")).toBeNull();
    expect(route("@Nova")).toEqual({ kind: "empty", bot: nova });
    expect(route("@Nova look at this", true)).toEqual({ kind: "attachments", bot: nova });
    // In the bot's own chat its name is ordinary text.
    expect(route("@Nova hello", false, nova.threadId)).toBeNull();
  });
});
