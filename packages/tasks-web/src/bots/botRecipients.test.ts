import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { BOTS_RPC_METHODS, TaskAgentId } from "@t3tools/tasks-contracts/v1";
import { describe, expect, it, vi } from "vite-plus/test";

const permissionState = vi.hoisted(() => ({
  allowed: false,
  listeners: new Set<() => void>(),
  subscribedMethod: null as string | null,
}));

vi.mock("../../../../apps/web/src/extensionApi.ts", () => ({
  readExperimentalFeatureRpcPermission: (_env: EnvironmentId, method: string) => {
    permissionState.subscribedMethod = method;
    return permissionState.allowed;
  },
  subscribeExperimentalFeatureRpcPermission: (
    _env: EnvironmentId,
    method: string,
    listener: () => void,
  ) => {
    permissionState.subscribedMethod = method;
    permissionState.listeners.add(listener);
    return () => {
      permissionState.listeners.delete(listener);
    };
  },
}));

vi.mock("../environmentApi.ts", () => ({
  readTasksWebAccess: () => ({ canReadAgents: true }),
  readTasksWebClient: () => ({ bots: { mention: vi.fn() } }),
  subscribeTasksWebAccess: () => () => undefined,
}));

const novaBot = {
  agent: { id: TaskAgentId.make("bot:nova"), name: "Nova" },
  threadId: ThreadId.make("thread-nova"),
};

vi.mock("./botData.tsx", () => ({
  readShownBots: () => [novaBot],
  subscribeBots: () => () => undefined,
}));

import { addressableBots, botComposerRecipients, subscribeBotRecipients } from "./botRecipients.ts";

const env = EnvironmentId.make("env-1");
const nova = { name: "Nova", threadId: ThreadId.make("thread-nova") };
const release = { name: "Release helper", threadId: ThreadId.make("thread-release") };

describe("bots a chat can address with @", () => {
  it("offers every bot in an ordinary chat", () => {
    expect(addressableBots([nova, release], ThreadId.make("thread-chat"))).toEqual([nova, release]);
  });

  it("leaves out the bot whose chat it is, so its own name sends there once", () => {
    expect(addressableBots([nova, release], nova.threadId)).toEqual([release]);
  });

  it("gates recipients with the mention command permission and reacts when it settles", () => {
    permissionState.allowed = false;
    permissionState.listeners.clear();
    permissionState.subscribedMethod = null;
    const chatThread = ThreadId.make("thread-chat");
    expect(botComposerRecipients({ environmentId: env, threadId: chatThread })).toEqual([]);
    expect(permissionState.subscribedMethod).toBe(BOTS_RPC_METHODS.mention);

    const onChange = vi.fn();
    const stop = subscribeBotRecipients(env, onChange);
    onChange.mockClear();
    permissionState.allowed = true;
    for (const listener of permissionState.listeners) listener();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      botComposerRecipients({ environmentId: env, threadId: chatThread }).map((r) => r.id),
    ).toEqual([novaBot.agent.id]);

    stop();
    expect(permissionState.listeners.size).toBe(0);
  });
});
