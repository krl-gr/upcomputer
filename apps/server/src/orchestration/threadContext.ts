import {
  type MessageId,
  type OrchestrationMessage,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ThreadContextBinding,
  type ThreadContextBindingId,
  type ThreadContextMaterialization,
  THREAD_CONTEXT_MAX_BINDINGS,
  THREAD_CONTEXT_MAX_CHARS_PER_BINDING,
  THREAD_CONTEXT_MAX_TOTAL_CHARS,
  THREAD_CONTEXT_MIN_USER_PROMPT_BUDGET,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@upcomputer/contracts";

export { THREAD_CONTEXT_MAX_BINDINGS };

export interface ThreadContextValidationResult {
  readonly ok: boolean;
  readonly detail?: string;
}

interface SelectedContextMessages {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly omittedMessages: number;
}

export interface MaterializeThreadContextResult {
  readonly blocks: ReadonlyArray<ThreadContextMaterialization>;
}

function compareMessages(left: OrchestrationMessage, right: OrchestrationMessage): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function isEligibleContextMessage(message: OrchestrationMessage): boolean {
  return (message.role === "user" || message.role === "assistant") && !message.streaming;
}

function eligibleContextMessages(thread: OrchestrationThread): ReadonlyArray<OrchestrationMessage> {
  return thread.messages.filter(isEligibleContextMessage).toSorted(compareMessages);
}

function selectNewestMessagesWithinBudget(
  messages: ReadonlyArray<OrchestrationMessage>,
  budget: number,
): SelectedContextMessages {
  if (messages.length === 0 || budget <= 0) {
    return {
      messages: [],
      omittedMessages: messages.length,
    };
  }

  const selected: OrchestrationMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const nextUsed = used + formatContextMessage(message).length + 2;
    if (selected.length > 0 && nextUsed > budget) {
      break;
    }
    if (nextUsed > budget) {
      selected.unshift(trimMessageToBudget(message, budget));
      used = budget;
      break;
    }
    selected.unshift(message);
    used = nextUsed;
  }

  return {
    messages: selected,
    omittedMessages: Math.max(0, messages.length - selected.length),
  };
}

function trimMessageToBudget(message: OrchestrationMessage, budget: number): OrchestrationMessage {
  const label = `${message.role.toUpperCase()}:\n`;
  const marker = "[earlier content omitted]\n";
  const available = budget - label.length - marker.length;
  if (message.text.length <= available) {
    return message;
  }
  if (available <= 0) {
    return {
      ...message,
      text: marker.trimEnd(),
    };
  }
  return {
    ...message,
    text: `${marker}${message.text.slice(-available)}`,
  };
}

function formatContextMessage(message: OrchestrationMessage): string {
  return `${message.role.toUpperCase()}:\n${message.text.trim()}`;
}

function formatContextBlock(input: {
  readonly sourceThreadId: string;
  readonly sourceThreadTitle: string;
  readonly messagesIncluded: number;
  readonly omittedMessages: number;
  readonly body: string;
}): string {
  const body = input.body.trim();
  return [
    `<attached_chat_context source_thread_id="${input.sourceThreadId}" mode="snapshot">`,
    `Source thread: ${input.sourceThreadTitle}`,
    `Messages included: ${input.messagesIncluded}`,
    `Messages omitted: ${input.omittedMessages}`,
    "",
    body,
    "</attached_chat_context>",
  ].join("\n");
}

function formatMessagesAsContext(input: {
  readonly sourceThread: OrchestrationThread;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly omittedMessages: number;
}): string {
  return formatContextBlock({
    sourceThreadId: input.sourceThread.id,
    sourceThreadTitle: input.sourceThread.title,
    messagesIncluded: input.messages.length,
    omittedMessages: input.omittedMessages,
    body: input.messages.map(formatContextMessage).join("\n\n"),
  });
}

function trimTextToBudget(text: string, budget: number): string {
  if (budget <= 0) {
    return "";
  }
  if (text.length <= budget) {
    return text;
  }
  const marker = "[earlier attached chat context omitted]\n";
  const available = budget - marker.length;
  if (available <= 0) {
    return marker.slice(0, budget);
  }
  return `${marker}${text.slice(-available)}`;
}

function contextBudgetForPrompt(userPromptLength: number): number {
  const providerBudget = Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS - userPromptLength - THREAD_CONTEXT_MIN_USER_PROMPT_BUDGET,
  );
  return Math.max(0, Math.min(THREAD_CONTEXT_MAX_TOTAL_CHARS, providerBudget));
}

export function prependThreadContextBlocksToPrompt(input: {
  readonly prompt: string;
  readonly contextBlocks: ReadonlyArray<ThreadContextMaterialization>;
}): string {
  if (input.contextBlocks.length === 0) {
    return input.prompt;
  }
  const contextText = input.contextBlocks
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
  if (!contextText) {
    return input.prompt;
  }
  return [
    contextText,
    "",
    "<current_user_request>",
    input.prompt.trim(),
    "</current_user_request>",
  ].join("\n");
}

export function validateThreadContextBinding(input: {
  readonly readModel: OrchestrationReadModel;
  readonly targetThreadId: string;
  readonly sourceThreadId: string;
  readonly existingBindingId?: string;
}): ThreadContextValidationResult {
  if (input.targetThreadId === input.sourceThreadId) {
    return { ok: false, detail: "A thread cannot attach itself as context." };
  }

  const targetThread = input.readModel.threads.find((thread) => thread.id === input.targetThreadId);
  if (!targetThread || targetThread.deletedAt !== null) {
    return { ok: false, detail: `Target thread '${input.targetThreadId}' does not exist.` };
  }

  const sourceThread = input.readModel.threads.find((thread) => thread.id === input.sourceThreadId);
  if (!sourceThread || sourceThread.deletedAt !== null) {
    return { ok: false, detail: `Source thread '${input.sourceThreadId}' does not exist.` };
  }

  const targetBindings = targetThread.contextBindings ?? [];
  const duplicate = targetBindings.find(
    (binding) =>
      binding.id !== input.existingBindingId && binding.sourceThreadId === input.sourceThreadId,
  );
  if (duplicate) {
    return {
      ok: false,
      detail: `Thread '${input.targetThreadId}' already has context from '${input.sourceThreadId}'.`,
    };
  }

  if (targetBindings.length >= THREAD_CONTEXT_MAX_BINDINGS) {
    return {
      ok: false,
      detail: `Thread '${input.targetThreadId}' already has the maximum of ${THREAD_CONTEXT_MAX_BINDINGS} context bindings.`,
    };
  }

  if (wouldCreateContextCycle(input.readModel, input.targetThreadId, input.sourceThreadId)) {
    return {
      ok: false,
      detail: `Attaching '${input.sourceThreadId}' to '${input.targetThreadId}' would create a context cycle.`,
    };
  }

  return { ok: true };
}

function wouldCreateContextCycle(
  readModel: OrchestrationReadModel,
  targetThreadId: string,
  sourceThreadId: string,
): boolean {
  const visited = new Set<string>();
  const stack = [sourceThreadId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === targetThreadId) {
      return true;
    }
    visited.add(current);
    const thread = readModel.threads.find((entry) => entry.id === current);
    if (!thread) continue;
    for (const binding of thread.contextBindings ?? []) {
      stack.push(binding.sourceThreadId);
    }
  }
  return false;
}

export function buildSnapshotThreadContextBinding(input: {
  readonly bindingId: ThreadContextBindingId;
  readonly targetThread: OrchestrationThread;
  readonly sourceThread: OrchestrationThread;
  readonly cutoffMessageId?: MessageId;
  readonly createdAt: string;
}): ThreadContextBinding | string {
  let messages = eligibleContextMessages(input.sourceThread);
  if (input.cutoffMessageId !== undefined) {
    const cutoffIndex = messages.findIndex((message) => message.id === input.cutoffMessageId);
    if (cutoffIndex < 0) {
      return `Source message '${input.cutoffMessageId}' does not exist or is still streaming.`;
    }
    const cutoffMessage = messages[cutoffIndex];
    if (!cutoffMessage || cutoffMessage.role !== "assistant") {
      return `Source message '${input.cutoffMessageId}' is not a completed assistant message.`;
    }
    messages = messages.slice(0, cutoffIndex + 1);
  }

  const selected = selectNewestMessagesWithinBudget(messages, THREAD_CONTEXT_MAX_CHARS_PER_BINDING);
  if (selected.messages.length === 0) {
    return "Source thread has no completed messages to attach.";
  }
  const snapshotText = formatMessagesAsContext({
    sourceThread: input.sourceThread,
    messages: selected.messages,
    omittedMessages: selected.omittedMessages,
  });

  return {
    id: input.bindingId,
    targetThreadId: input.targetThread.id,
    sourceThreadId: input.sourceThread.id,
    sourceProjectId: input.sourceThread.projectId,
    sourceThreadTitle: input.sourceThread.title,
    mode: "snapshot",
    ...(input.cutoffMessageId !== undefined ? { cutoffMessageId: input.cutoffMessageId } : {}),
    snapshotText,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function materializeThreadContextBindings(input: {
  readonly readModel: OrchestrationReadModel;
  readonly targetThread: OrchestrationThread;
  readonly userPromptLength: number;
}): MaterializeThreadContextResult {
  const totalBudget = contextBudgetForPrompt(input.userPromptLength);
  const targetBindings = input.targetThread.contextBindings ?? [];
  if (totalBudget <= 0 || targetBindings.length === 0) {
    return { blocks: [] };
  }

  const blocks: ThreadContextMaterialization[] = [];
  let remainingBudget = totalBudget;

  const bindings = targetBindings.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );

  for (const binding of bindings) {
    if (remainingBudget <= 0) break;
    const snapshotText = binding.snapshotText?.trim() ?? "";
    if (!snapshotText) continue;
    const perBindingBudget = Math.min(remainingBudget, THREAD_CONTEXT_MAX_CHARS_PER_BINDING);
    const text = trimTextToBudget(snapshotText, perBindingBudget);
    remainingBudget -= text.length;
    blocks.push({
      bindingId: binding.id,
      sourceThreadId: binding.sourceThreadId,
      sourceThreadTitle: binding.sourceThreadTitle,
      mode: "snapshot",
      messagesIncluded: 0,
      omittedMessages: 0,
      text,
    });
  }

  return { blocks };
}
