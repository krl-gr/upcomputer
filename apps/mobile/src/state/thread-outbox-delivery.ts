import type { EnvironmentThreadShell } from "@upcomputer/client-runtime/state/shell";
import type { AtomCommandResult } from "@upcomputer/client-runtime/state/runtime";
import {
  CommandId,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerConfig,
  type ThreadId,
  type UploadChatImageAttachment,
} from "@upcomputer/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import type { DraftComposerImageAttachment } from "../lib/composerImages";
import {
  resolveQueuedThreadSettings,
  shouldSynchronizeQueuedModelSelection,
  type QueuedThreadMessage,
  type ThreadOutboxCommandStage,
} from "./thread-outbox-model";

type CommandResult = AtomCommandResult<unknown, unknown>;
type ScopedCommandInput<Input> = {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
};
type StartTurnInput = ScopedCommandInput<{
  readonly commandId: QueuedThreadMessage["commandId"];
  readonly threadId: ThreadId;
  readonly message: {
    readonly messageId: QueuedThreadMessage["messageId"];
    readonly role: "user";
    readonly text: string;
    readonly attachments: ReadonlyArray<UploadChatImageAttachment>;
  };
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly createdAt: string;
}>;
type UpdateMetadataInput = ScopedCommandInput<{
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly modelSelection: ModelSelection;
}>;
type SetRuntimeModeInput = ScopedCommandInput<{
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly createdAt: string;
}>;
type SetInteractionModeInput = ScopedCommandInput<{
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly interactionMode: ProviderInteractionMode;
  readonly createdAt: string;
}>;

export interface QueuedThreadDeliveryCommands {
  readonly startTurn: (input: StartTurnInput) => Promise<CommandResult>;
  readonly updateThreadMetadata: (input: UpdateMetadataInput) => Promise<CommandResult>;
  readonly setThreadRuntimeMode: (input: SetRuntimeModeInput) => Promise<CommandResult>;
  readonly setThreadInteractionMode: (input: SetInteractionModeInput) => Promise<CommandResult>;
}

function settingsCommandId(message: QueuedThreadMessage, setting: string): CommandId {
  return CommandId.make(`${message.commandId}:${setting}`);
}

/**
 * Deliver one existing-thread outbox item after re-resolving its provider
 * binding against the latest projection. Returning false retains the item and
 * lets the drain apply its existing retry/backoff policy.
 */
export async function deliverQueuedThreadMessage(input: {
  readonly queuedMessage: QueuedThreadMessage;
  readonly thread: EnvironmentThreadShell;
  readonly serverConfig: ServerConfig | null | undefined;
  readonly commands: QueuedThreadDeliveryCommands;
  readonly toUploadAttachments: (
    attachments: ReadonlyArray<DraftComposerImageAttachment>,
  ) => ReadonlyArray<UploadChatImageAttachment>;
  readonly reportFailure: (result: CommandResult, stage: ThreadOutboxCommandStage) => boolean;
  readonly completeDelivery: (result: CommandResult) => Promise<boolean>;
}): Promise<boolean> {
  const { queuedMessage, thread, commands } = input;
  const settings = resolveQueuedThreadSettings(queuedMessage, thread, input.serverConfig);
  if (settings === null) {
    return false;
  }

  if (shouldSynchronizeQueuedModelSelection(settings, thread)) {
    const updateResult = await commands.updateThreadMetadata({
      environmentId: queuedMessage.environmentId,
      input: {
        commandId: settingsCommandId(queuedMessage, "model-selection"),
        threadId: queuedMessage.threadId,
        modelSelection: settings.modelSelection,
      },
    });
    if (AsyncResult.isFailure(updateResult)) {
      input.reportFailure(updateResult, "settings-sync");
      return false;
    }
  }

  if (settings.runtimeMode !== thread.runtimeMode) {
    const runtimeResult = await commands.setThreadRuntimeMode({
      environmentId: queuedMessage.environmentId,
      input: {
        commandId: settingsCommandId(queuedMessage, "runtime-mode"),
        threadId: queuedMessage.threadId,
        runtimeMode: settings.runtimeMode,
        createdAt: queuedMessage.createdAt,
      },
    });
    if (AsyncResult.isFailure(runtimeResult)) {
      input.reportFailure(runtimeResult, "settings-sync");
      return false;
    }
  }

  if (settings.interactionMode !== thread.interactionMode) {
    const interactionResult = await commands.setThreadInteractionMode({
      environmentId: queuedMessage.environmentId,
      input: {
        commandId: settingsCommandId(queuedMessage, "interaction-mode"),
        threadId: queuedMessage.threadId,
        interactionMode: settings.interactionMode,
        createdAt: queuedMessage.createdAt,
      },
    });
    if (AsyncResult.isFailure(interactionResult)) {
      input.reportFailure(interactionResult, "settings-sync");
      return false;
    }
  }

  const deliveryResult = await commands.startTurn({
    environmentId: queuedMessage.environmentId,
    input: {
      commandId: queuedMessage.commandId,
      threadId: queuedMessage.threadId,
      message: {
        messageId: queuedMessage.messageId,
        role: "user",
        text: queuedMessage.text,
        attachments: input.toUploadAttachments(queuedMessage.attachments),
      },
      modelSelection: settings.modelSelection,
      runtimeMode: settings.runtimeMode,
      interactionMode: settings.interactionMode,
      createdAt: queuedMessage.createdAt,
    },
  });
  return input.completeDelivery(deliveryResult);
}
