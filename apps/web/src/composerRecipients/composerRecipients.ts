import type { NavigateOptions } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { msg } from "gt-react";
import { useSyncExternalStore } from "react";

import type { ChatComposerHandle } from "../components/chat/ChatComposer";
import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import { errorToastDescription } from "../components/errors/ErrorDetails";
import { toastManager } from "../components/ui/toast";
import { stackedThreadToast } from "../components/ui/toastHelpers";
import { type ComposerThreadTarget, useComposerDraftStore } from "../composerDraftStore";
import { m } from "../i18n/messages";
import { filterTerminalContextsWithText } from "../lib/terminalContext";
import { WEB_PRODUCT } from "../product/productEntry";
import type { ExperimentalWebComposerRecipient } from "../product/WebFeature";
import {
  type ComposerRecipientMessage,
  matchComposerRecipients,
  parseComposerRecipientMessage,
  withoutComposerRecipientChats,
} from "./composerRecipients.logic";

const EMPTY_RECIPIENTS: ReadonlyArray<ExperimentalWebComposerRecipient> = [];

/**
 * Who the composer of `threadId` can address with `@`, from every product feature, with ids
 * no other feature uses. A feature that fails to answer adds nobody.
 */
function productComposerRecipients(
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

let recipientsRevision = 0;
const readRecipientsRevision = () => recipientsRevision;
const subscribeNever = () => () => undefined;
const subscribersByEnvironment = new Map<EnvironmentId, (listener: () => void) => () => void>();

// One stable subscribe function per environment so useSyncExternalStore does not resubscribe
// even where the React Compiler does not run.
function subscribeForEnvironment(environmentId: EnvironmentId | null) {
  if (environmentId === null) return subscribeNever;
  let subscribe = subscribersByEnvironment.get(environmentId);
  if (subscribe === undefined) {
    subscribe = (listener: () => void) => {
      const onChange = () => {
        recipientsRevision += 1;
        listener();
      };
      const stops = WEB_PRODUCT.features.flatMap((feature) =>
        feature.subscribeComposerRecipients
          ? [feature.subscribeComposerRecipients(environmentId, onChange)]
          : [],
      );
      return () => {
        for (const stop of stops) stop();
      };
    };
    subscribersByEnvironment.set(environmentId, subscribe);
  }
  return subscribe;
}

/**
 * Who the composer of `threadId` can address, kept current while it is mounted: features load
 * what they answer from, whether or not the view that usually shows it, such as the sidebar, is.
 */
export function useProductComposerRecipients(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ReadonlyArray<ExperimentalWebComposerRecipient> {
  const revision = useSyncExternalStore(
    subscribeForEnvironment(environmentId),
    readRecipientsRevision,
    readRecipientsRevision,
  );
  return environmentId === null
    ? EMPTY_RECIPIENTS
    : composerRecipientsAt(environmentId, threadId, revision);
}

// `revision` is not read: it makes the React Compiler ask again once a feature's state changed.
const composerRecipientsAt = (
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  _revision: number,
) => productComposerRecipients(environmentId, threadId);

function composerRecipientItems(
  recipients: ReadonlyArray<ExperimentalWebComposerRecipient>,
  query: string,
): ComposerCommandItem[] {
  return matchComposerRecipients(recipients, query).map((recipient) => ({
    id: `recipient:${recipient.id}`,
    type: "recipient",
    recipientId: recipient.id,
    name: recipient.name,
    icon: recipient.icon,
    label: recipient.name,
    description: recipient.description,
  }));
}

/** Keeps the upstream `@` menu hook to two lines: recipient items and thread filtering. */
export function useComposerRecipientMenu(
  environmentId: EnvironmentId,
  activeThreadId: ThreadId | null,
) {
  const recipients = useProductComposerRecipients(environmentId, activeThreadId);
  return {
    items: (query: string, enabled: boolean): ComposerCommandItem[] =>
      enabled ? composerRecipientItems(recipients, query) : [],
    filterThreads: <S extends { readonly environmentId: string; readonly id: string }>(
      shells: ReadonlyArray<S>,
    ) => withoutComposerRecipientChats(shells, environmentId, recipients),
  };
}

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

const sendingThreads = new Set<string>();

/**
 * Sends the message to its recipient instead of the open chat, and says where it went when the
 * reply does not come back here. It resolves false, keeping the draft, when nothing was sent.
 */
async function sendComposerRecipientMessage(input: {
  readonly sendKey: string;
  readonly message: ComposerRecipientMessage<ExperimentalWebComposerRecipient>;
  readonly sendContext: ReturnType<ChatComposerHandle["getSendContext"]>;
  readonly draftTarget: ComposerThreadTarget;
  readonly navigate: (options: NavigateOptions) => Promise<void>;
}): Promise<boolean> {
  if (sendingThreads.has(input.sendKey)) {
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: m(msg("Sending previous message")),
        description: m(msg("Wait a moment for the earlier mention to finish sending.")),
      }),
    );
    return false;
  }
  if ("recipients" in input.message) {
    const names = input.message.recipients.map((recipient) => `@${recipient.name}`).join(", ");
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: m(msg("Mention one bot per message")),
        description: m(msg("This message mentions {names}. Send each its own message.", { names })),
      }),
    );
    return false;
  }
  const { recipient, text } = input.message;
  const mention = `@${recipient.name}`;
  if (draftHasContext(input.sendContext, input.draftTarget)) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: m(msg("Messages to {mention} take text only", { mention })),
        description: m(msg("Remove the attachments and context, then send it again.")),
      }),
    );
    return false;
  }
  if (text === "") {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: m(msg("Write a message after {mention}", { mention })),
      }),
    );
    return false;
  }
  sendingThreads.add(input.sendKey);
  let repliesHere = false;
  try {
    ({ repliesHere } = await recipient.send(text));
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: m(msg("Couldn't send to {mention}", { mention })),
        description: errorToastDescription(error),
      }),
    );
    return false;
  } finally {
    sendingThreads.delete(input.sendKey);
  }
  // The chat shows the message and, later, the reply.
  if (repliesHere) return true;
  toastManager.add(
    stackedThreadToast({
      type: "success",
      title: m(msg("Sent to {mention}", { mention })),
      description: m(msg("It answers in its own chat.")),
      actionProps: {
        children: m(msg("Open chat")),
        onClick: () => recipient.open({ navigate: input.navigate }),
      },
    }),
  );
  return true;
}

/**
 * Handles sending to a mentioned recipient from the composer. Returns true when the send was
 * intercepted (sent or refused with a toast), so the caller does not send to the open chat.
 */
export async function trySendComposerRecipient(input: {
  readonly sendContext: ReturnType<ChatComposerHandle["getSendContext"]> | null | undefined;
  readonly blocked: boolean;
  readonly prompt: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftTarget: ComposerThreadTarget;
  readonly routeThreadKey: string;
  readonly currentRouteThreadKeyRef: { readonly current: string | null };
  readonly promptRef: { current: string };
  readonly composerRef: { readonly current: ChatComposerHandle | null };
  readonly setPrompt: (target: ComposerThreadTarget, prompt: string) => void;
  readonly navigate: (options: NavigateOptions) => Promise<void>;
}): Promise<boolean> {
  if (!input.sendContext || input.blocked) return false;
  const message = parseComposerRecipientMessage(
    input.prompt,
    productComposerRecipients(input.environmentId, input.threadId),
  );
  if (message === null) return false;
  const sent = await sendComposerRecipientMessage({
    sendKey: `${input.environmentId}:${input.threadId}`,
    message,
    sendContext: input.sendContext,
    draftTarget: input.draftTarget,
    navigate: input.navigate,
  });
  if (
    sent &&
    input.currentRouteThreadKeyRef.current === input.routeThreadKey &&
    input.promptRef.current === input.prompt
  ) {
    input.promptRef.current = "";
    input.setPrompt(input.draftTarget, "");
    input.composerRef.current?.resetCursorState();
  }
  return true;
}
