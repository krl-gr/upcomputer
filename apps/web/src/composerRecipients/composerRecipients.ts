import type { NavigateOptions } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { ChatComposerHandle } from "../components/chat/ChatComposer";
import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import { errorToastDescription } from "../components/errors/ErrorDetails";
import { toastManager } from "../components/ui/toast";
import { stackedThreadToast } from "../components/ui/toastHelpers";
import { type ComposerThreadTarget, useComposerDraftStore } from "../composerDraftStore";
import { filterTerminalContextsWithText } from "../lib/terminalContext";
import { WEB_PRODUCT } from "../product/productEntry";
import type { ExperimentalWebComposerRecipient } from "../product/WebFeature";
import { matchComposerRecipients, parseComposerRecipientMessage } from "./composerRecipients.logic";

/**
 * Who the composer of `threadId` can address with `@`, from every product feature, with ids
 * no other feature uses. A feature that fails to answer adds nobody.
 */
export function productComposerRecipients(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): ReadonlyArray<ExperimentalWebComposerRecipient> {
  return WEB_PRODUCT.features.flatMap((feature) => {
    if (!feature.composerRecipients) return [];
    try {
      return feature
        .composerRecipients({ environmentId, threadId })
        .map((recipient) => ({ ...recipient, id: `feature:${feature.id}:${recipient.id}` }));
    } catch {
      return [];
    }
  });
}

export function matchComposerRecipientItems(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  query: string,
): ComposerCommandItem[] {
  return matchComposerRecipients(productComposerRecipients(environmentId, threadId), query).map(
    (recipient) => ({
      id: `recipient:${recipient.id}`,
      type: "recipient",
      name: recipient.name,
      icon: recipient.icon,
      label: recipient.name,
      description: recipient.description,
    }),
  );
}

export const parseProductComposerRecipientMessage = (
  prompt: string,
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
) => parseComposerRecipientMessage(prompt, productComposerRecipients(environmentId, threadId));

/** Attachments, context or a reply that a text-only message would lose. */
function draftHasContext(
  context: ReturnType<ChatComposerHandle["getSendContext"]>,
  draftTarget: ComposerThreadTarget,
) {
  return (
    context.images.length > 0 ||
    context.files.length > 0 ||
    filterTerminalContextsWithText(context.terminalContexts).length > 0 ||
    context.previewAnnotations.length > 0 ||
    context.reviewComments.length > 0 ||
    context.threadContexts.length > 0 ||
    context.environmentContexts.length > 0 ||
    Boolean(useComposerDraftStore.getState().getComposerDraft(draftTarget)?.replyTo)
  );
}

let sending = false;

/**
 * Sends the message to its recipient instead of the open chat, and says where it went when the
 * reply does not come back here. It resolves false, keeping the draft, when nothing was sent, also while an earlier one is still
 * on its way.
 */
export async function sendComposerRecipientMessage(input: {
  readonly message: NonNullable<ReturnType<typeof parseProductComposerRecipientMessage>>;
  readonly sendContext: ReturnType<ChatComposerHandle["getSendContext"]>;
  readonly draftTarget: ComposerThreadTarget;
  readonly navigate: (options: NavigateOptions) => Promise<void>;
}): Promise<boolean> {
  const { recipient, text } = input.message;
  const mention = `@${recipient.name}`;
  if (sending) return false;
  if (draftHasContext(input.sendContext, input.draftTarget)) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: `Messages to ${mention} take text only`,
        description: "Remove the attachments and context, then send it again.",
      }),
    );
    return false;
  }
  if (text === "") {
    toastManager.add(
      stackedThreadToast({ type: "warning", title: `Write a message after ${mention}` }),
    );
    return false;
  }
  sending = true;
  let repliesHere = false;
  try {
    ({ repliesHere } = await recipient.send(text));
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: `Couldn't send to ${mention}`,
        description: errorToastDescription(error),
      }),
    );
    return false;
  } finally {
    sending = false;
  }
  // The chat shows the message and, later, the reply.
  if (repliesHere) return true;
  toastManager.add(
    stackedThreadToast({
      type: "success",
      title: `Sent to ${mention}`,
      description: "It answers in its own chat.",
      actionProps: {
        children: "Open chat",
        onClick: () => recipient.open({ navigate: input.navigate }),
      },
    }),
  );
  return true;
}
