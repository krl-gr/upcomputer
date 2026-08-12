import { describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  type ServerConfig,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  deliverQueuedThreadMessage,
  type QueuedThreadDeliveryCommands,
} from "./thread-outbox-delivery";
import type { QueuedThreadMessage } from "./thread-outbox-model";

const queuedMessage = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  commandId: CommandId.make("command-1"),
  text: "keep this message",
  attachments: [],
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex_personal"),
    model: "personal-model",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: "2026-08-12T10:00:00.000Z",
} satisfies QueuedThreadMessage;

const startedThread = {
  environmentId: queuedMessage.environmentId,
  id: queuedMessage.threadId,
  modelSelection: queuedMessage.modelSelection,
  runtimeMode: queuedMessage.runtimeMode,
  interactionMode: queuedMessage.interactionMode,
  latestTurn: {},
  session: {
    providerInstanceId: ProviderInstanceId.make("codex_work"),
  },
} as unknown as EnvironmentThreadShell;

const serverConfig = {
  providers: [
    {
      instanceId: "codex_work",
      driver: "codex",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [
        {
          slug: "work-default",
          name: "Work Default",
          isDefault: true,
          capabilities: null,
        },
      ],
    },
  ],
} as unknown as ServerConfig;

function commandMocks() {
  const startTurn = vi
    .fn<QueuedThreadDeliveryCommands["startTurn"]>()
    .mockResolvedValue(AsyncResult.success(undefined));
  const updateThreadMetadata = vi
    .fn<QueuedThreadDeliveryCommands["updateThreadMetadata"]>()
    .mockResolvedValue(AsyncResult.success(undefined));
  const setThreadRuntimeMode = vi
    .fn<QueuedThreadDeliveryCommands["setThreadRuntimeMode"]>()
    .mockResolvedValue(AsyncResult.success(undefined));
  const setThreadInteractionMode = vi
    .fn<QueuedThreadDeliveryCommands["setThreadInteractionMode"]>()
    .mockResolvedValue(AsyncResult.success(undefined));
  const commands = {
    startTurn,
    updateThreadMetadata,
    setThreadRuntimeMode,
    setThreadInteractionMode,
  } satisfies QueuedThreadDeliveryCommands;
  return {
    commands,
    startTurn,
    updateThreadMetadata,
    setThreadRuntimeMode,
    setThreadInteractionMode,
  };
}

describe("queued thread delivery", () => {
  it("rebinds a historical mismatch before startTurn without sending conflicting metadata", async () => {
    const mocks = commandMocks();
    const reportFailure = vi.fn(() => false);
    const completeDelivery = vi.fn(async () => true);

    await expect(
      deliverQueuedThreadMessage({
        queuedMessage,
        thread: startedThread,
        serverConfig,
        commands: mocks.commands,
        toUploadAttachments: () => [],
        reportFailure,
        completeDelivery,
      }),
    ).resolves.toBe(true);

    expect(mocks.startTurn).toHaveBeenCalledOnce();
    expect(mocks.startTurn.mock.calls[0]?.[0].input.modelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex_work"),
      model: "work-default",
    });
    expect(mocks.updateThreadMetadata).toHaveBeenCalledOnce();
    expect(mocks.updateThreadMetadata.mock.calls[0]?.[0].input.modelSelection.instanceId).toBe(
      ProviderInstanceId.make("codex_work"),
    );
    expect(mocks.updateThreadMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startTurn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(reportFailure).not.toHaveBeenCalled();
    expect(completeDelivery).toHaveBeenCalledOnce();
  });

  it("retains the item and invokes no commands while safe normalization is unavailable", async () => {
    const mocks = commandMocks();
    const reportFailure = vi.fn(() => false);
    const completeDelivery = vi.fn(async () => true);

    await expect(
      deliverQueuedThreadMessage({
        queuedMessage,
        thread: startedThread,
        serverConfig: null,
        commands: mocks.commands,
        toUploadAttachments: () => [],
        reportFailure,
        completeDelivery,
      }),
    ).resolves.toBe(false);

    expect(mocks.startTurn).not.toHaveBeenCalled();
    expect(mocks.updateThreadMetadata).not.toHaveBeenCalled();
    expect(mocks.setThreadRuntimeMode).not.toHaveBeenCalled();
    expect(mocks.setThreadInteractionMode).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
    expect(completeDelivery).not.toHaveBeenCalled();
  });
});
