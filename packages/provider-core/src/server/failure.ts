import {
  PROVIDER_DISPLAY_NAMES,
  type NodeId,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ProviderFailureClass,
  type OrchestrationV2ProviderRetry,
  type OrchestrationV2TurnItem,
  type ProviderDriverKind,
  type ProviderThreadId,
  type ProviderTurnId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Cause from "effect/Cause";

import * as IdAllocator from "./IdAllocator.ts";
import type { ProviderAdapterFailureReason } from "./ProviderAdapter.ts";
import * as Schema from "effect/Schema";

export class ContextHandoffBudgetError extends Schema.TaggedError<ContextHandoffBudgetError>()(
  "ContextHandoffBudgetError",
  {},
) {
  override get message() {
    return "Your message and attachments leave too little room for this model, even in a fresh conversation. Shorten the message or pick a model with a larger context window.";
  }
}

export class ContextHandoffBackgroundWorkError extends Schema.TaggedError<ContextHandoffBackgroundWorkError>()(
  "ContextHandoffBackgroundWorkError",
  {},
) {
  override get message() {
    return "The agent is still finishing background work from earlier. Wait for it to finish, or stop it, then send the message again.";
  }
}

export const MAX_PROVIDER_FAILURE_MESSAGE_LENGTH = 4_096;
const MAX_PROVIDER_FAILURE_CODE_LENGTH = 128;
const MAX_PROVIDER_FAILURE_REASON_LENGTH = 240;

/**
 * Codes the presenter assigns when the cause carries none. Clients pick a title
 * and an action from them.
 */
const ProviderFailureCode = {
  sessionOpen: "session_open_failed",
  turnStart: "turn_start_failed",
  connectionLost: "connection_lost",
  resume: "resume_failed",
  compactUnsupported: "compact_unsupported",
  attachmentUnsupported: "attachment_unsupported",
  contextTooLong: "context_too_long",
  handoffUncertain: "handoff_uncertain",
  crashed: "provider_crashed",
  workspaceMissing: "workspace_missing",
  instanceMissing: "provider_instance_missing",
} as const;

const AGENT = "The agent";

/** A provider name inside a sentence: the generic "The agent" reads "the agent" there. */
function midSentence(provider: string): string {
  return provider === AGENT ? "the agent" : provider;
}

export function providerFailureName(
  driver: ProviderDriverKind | string | undefined,
  fallback: string = AGENT,
): string {
  if (driver === undefined) return fallback;
  const name = PROVIDER_DISPLAY_NAMES[driver as ProviderDriverKind];
  // Registry agents share one driver, so its label would name the registry, not the agent.
  return name === undefined || driver === "acpRegistry" ? fallback : name;
}

type CauseWrapper = "turn_start" | "event_stream" | "open_session" | "resume";

interface DescribedCause {
  readonly message: string;
  readonly code: string | undefined;
  readonly retryable: boolean | undefined;
  readonly detail: string | undefined;
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

/** A reason short enough to read inside a sentence, without a trailing period. */
function plainReason(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let line = firstLine(value)
    .replace(/^(?:Error|[A-Z][A-Za-z]*Error):\s*/u, "")
    .replace(/[.\s]+$/u, "");
  if (line.length === 0) return undefined;
  if (line.length > MAX_PROVIDER_FAILURE_REASON_LENGTH) {
    line = `${line.slice(0, MAX_PROVIDER_FAILURE_REASON_LENGTH - 1)}…`;
  }
  const firstWord = /^[A-Z][a-z]+\b/u.exec(line)?.[0];
  return firstWord === undefined || PROPER_NOUNS.has(firstWord)
    ? line
    : line.charAt(0).toLowerCase() + line.slice(1);
}

const PROPER_NOUNS = new Set([
  ...Object.values(PROVIDER_DISPLAY_NAMES),
  "Anthropic",
  "ChatGPT",
  "Gemini",
  "Git",
  "Google",
  "Mistral",
  "Qwen",
]);

/**
 * Typed fields our own code writes for the user. Free-form `message` and defect
 * text are never promoted to the main message; they only go to the detail.
 */
const PROVIDER_FAILURE_REASONS: Record<ProviderAdapterFailureReason, string> = {
  previous_turn_active: "the previous turn is still running",
  attachment_unreadable: "an attachment could not be read",
};

function safeReason(record: Record<string, unknown>): string | undefined {
  switch (record._tag) {
    case "ProviderAdapterProtocolError":
      if (
        typeof record.reason === "string" &&
        Object.hasOwn(PROVIDER_FAILURE_REASONS, record.reason)
      )
        return PROVIDER_FAILURE_REASONS[record.reason as ProviderAdapterFailureReason];
      return typeof record.detail === "string" ? record.detail : undefined;
    case "ProviderSetupError":
    case "OpenCodeRuntimeError":
    case "AcpTransportError":
      return typeof record.detail === "string" ? record.detail : undefined;
    case "AcpRequestError": {
      const data = record.data;
      if (typeof data === "object" && data !== null) {
        for (const key of ["message", "details"] as const) {
          const value = (data as Record<string, unknown>)[key];
          if (typeof value === "string" && value.trim().length > 0) return value;
        }
      }
      return typeof record.errorMessage === "string" ? record.errorMessage : undefined;
    }
    case "AcpProcessExitedError":
      return typeof record.code === "number"
        ? `it quit with exit code ${record.code}`
        : "it quit unexpectedly";
    default:
      return undefined;
  }
}

function rawText(record: Record<string, unknown>): string | undefined {
  for (const key of ["detail", "errorMessage", "message", "stderr"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function describeCause(cause: unknown, provider: string): DescribedCause | undefined {
  const seen = new Set<unknown>();
  let wrapper: CauseWrapper | undefined;
  let reason: string | undefined;
  const raw: Array<string> = [];
  for (let depth = 0; depth < 16 && cause != null && !seen.has(cause); depth++) {
    seen.add(cause);
    try {
      if (Cause.isCause(cause)) {
        cause = Cause.squash(cause);
        continue;
      }
      if (typeof cause === "string") {
        raw.push(cause);
        break;
      }
      if (typeof cause !== "object") break;
      const record = cause as Record<string, unknown>;
      switch (record._tag) {
        case "ContextHandoffBudgetError":
          return {
            message: new ContextHandoffBudgetError().message,
            code: ProviderFailureCode.contextTooLong,
            retryable: false,
            detail: undefined,
          };
        case "ContextHandoffBackgroundWorkError":
          return {
            message: new ContextHandoffBackgroundWorkError().message,
            code: undefined,
            retryable: true,
            detail: undefined,
          };
        case "AcpModelSelectionError":
        case "ClaudeBackgroundWorkBlocksQueryReplacementError":
        case "ClaudeAppendSystemPromptFileError":
        case "ClaudeAppendSystemPromptMissingValueError":
        case "ClaudeSettingsLaunchArgError":
        case "ClaudeMcpRegistrationTimeoutError":
        case "CursorModelUnavailableError":
          return {
            message: stringField(cause, "message") ?? "",
            code: undefined,
            retryable: undefined,
            detail: undefined,
          };
        case "ContextHandoffDeliveryUncertainError":
          return {
            message: `Up.computer couldn't confirm that ${provider} received the earlier conversation. Send the message again to resend it.`,
            code: ProviderFailureCode.handoffUncertain,
            retryable: true,
            detail: undefined,
          };
        case "ProviderAdapterTurnStartError":
          wrapper = "turn_start";
          // The innermost wrapper names the failure; an outer reason does not carry into it.
          reason = undefined;
          break;
        case "ProviderAdapterEventStreamError":
          wrapper = "event_stream";
          // The innermost wrapper names the failure; an outer reason does not carry into it.
          reason = undefined;
          break;
        case "ProviderAdapterOpenSessionError":
        case "ProviderSessionOpenError":
          wrapper = "open_session";
          // The innermost wrapper names the failure; an outer reason does not carry into it.
          reason = undefined;
          break;
        case "ProviderWorkspaceMissingError":
          return {
            message: `The folder ${stringField(record, "cwd") ?? "for this thread"} is missing. Move it back, or update the project's location in Settings.`,
            code: ProviderFailureCode.workspaceMissing,
            retryable: false,
            detail: undefined,
          };
        case "ProviderInstanceNotFoundError":
          return {
            message:
              "The agent this thread used was removed. Pick another agent for this thread, or add it again in Settings.",
            code: ProviderFailureCode.instanceMissing,
            retryable: false,
            detail: stringField(record, "instanceId"),
          };
        case "ProviderAdapterResumeThreadError":
        case "ProviderAdapterEnsureThreadError":
          wrapper = "resume";
          // The innermost wrapper names the failure; an outer reason does not carry into it.
          reason = undefined;
          break;
        default: {
          const text = rawText(record);
          if (text !== undefined) raw.push(text);
        }
      }
      reason = safeReason(record) ?? reason;
      cause = record.cause;
    } catch {
      break;
    }
  }
  const detail = raw.length === 0 ? undefined : [...new Set(raw)].join("\n");
  const plain = plainReason(reason);
  if (plain !== undefined && /compaction/iu.test(plain) && /not support/iu.test(plain)) {
    return {
      message: `${provider} doesn't support /compact. Start a new thread to continue with a shorter context.`,
      code: ProviderFailureCode.compactUnsupported,
      retryable: false,
      detail,
    };
  }
  if (plain !== undefined && /\b(?:image|attachment)\b/iu.test(plain)) {
    return {
      message: `${provider} can't read this attachment (${plain}). Remove it or send a different file.`,
      code: ProviderFailureCode.attachmentUnsupported,
      retryable: false,
      detail,
    };
  }
  const because = plain === undefined ? "" : ` (${plain})`;
  switch (wrapper) {
    case "turn_start":
      return {
        message: `${provider} couldn't start this reply${plain === undefined ? "" : `: ${plain}`}. Send the message again.`,
        code: ProviderFailureCode.turnStart,
        retryable: true,
        detail,
      };
    case "event_stream":
      return {
        message: `The connection to ${provider} dropped while it was working${because}. Send the message again to continue.`,
        code: ProviderFailureCode.connectionLost,
        retryable: true,
        detail,
      };
    case "open_session":
      return {
        message: `${provider} couldn't start${plain === undefined ? "" : `: ${plain}`}. Check ${midSentence(provider)} in Settings, then send the message again.`,
        code: ProviderFailureCode.sessionOpen,
        retryable: true,
        detail,
      };
    case "resume":
      return {
        message: `${provider} couldn't reopen this conversation${because}. Send the message again, or start a new thread.`,
        code: ProviderFailureCode.resume,
        retryable: true,
        detail,
      };
    case undefined:
      if (plain === undefined)
        return detail === undefined ? undefined : unexplained(provider, detail);
      return {
        message: `${provider} stopped before finishing: ${plain}. Send the message again; if it keeps happening, check ${midSentence(provider)} in Settings.`,
        code: undefined,
        retryable: undefined,
        detail,
      };
  }
}

function unexplained(provider: string, detail: string | undefined): DescribedCause {
  return {
    message: `${provider} stopped with an error it didn't explain. Send the message again; if it repeats, check ${midSentence(provider)} in Settings.`,
    code: undefined,
    retryable: undefined,
    detail,
  };
}

function stringField(
  value: unknown,
  key: "message" | "code" | "cwd" | "instanceId",
): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function redactUrl(match: string): string {
  const trailing = /[),.;!?]+$/u.exec(match)?.[0] ?? "";
  const candidate = trailing.length === 0 ? match : match.slice(0, -trailing.length);
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.toString()}${trailing}`;
  } catch {
    return "[REDACTED_URL]";
  }
}

function replaceUnsafeControlCharacters(value: string): string {
  const sanitized: Array<string> = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized.push(
      codePoint <= 0x08 ||
        (codePoint >= 0x0b && codePoint <= 0x0c) ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f
        ? " "
        : character,
    );
  }
  return sanitized.join("");
}

function redactProviderFailureText(value: string): string {
  return replaceUnsafeControlCharacters(value)
    .replace(/\bhttps?:\/\/[^\s<>"']+/giu, redactUrl)
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(
      /(["'](?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)["']\s*:\s*["'])[^"']*(["'])/giu,
      "$1[REDACTED]$2",
    )
    .replace(
      /(\b(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1[REDACTED]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, "[REDACTED]")
    .trim();
}

function boundedText(value: string, maxLength: number): string {
  const redacted = redactProviderFailureText(value);
  if (redacted.length <= maxLength) return redacted;
  let end = Math.max(0, maxLength - 1);
  const finalCodeUnit = redacted.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    end -= 1;
  }
  return `${redacted.slice(0, end)}…`;
}

export function makeProviderFailure(input: {
  readonly cause?: unknown;
  readonly message?: string | undefined;
  readonly code?: string | null | undefined;
  readonly class?: OrchestrationV2ProviderFailureClass;
  readonly retryable?: boolean | null;
  readonly resetAt?: string | null;
  /** Names the provider in the presenter's sentences. */
  readonly driver?: ProviderDriverKind | string | undefined;
  /** Overrides the driver's display name, e.g. with a registry agent's own name. */
  readonly provider?: string | undefined;
  /** Technical text for the client's Details disclosure; never the main message. */
  readonly detail?: string | undefined;
}): OrchestrationV2ProviderFailure {
  const provider = input.provider ?? providerFailureName(input.driver);
  const described =
    input.cause === undefined ? undefined : describeCauseSafely(input.cause, provider);
  const fallback = unexplained(provider, undefined).message;
  const rawMessage = input.message ?? described?.message ?? fallback;
  const message = boundedText(rawMessage, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH);
  const rawCode = input.code ?? stringField(input.cause, "code") ?? described?.code ?? null;
  const code =
    rawCode === null ? null : boundedText(rawCode, MAX_PROVIDER_FAILURE_CODE_LENGTH) || null;
  const rawDetail = input.detail ?? described?.detail;
  const detail =
    rawDetail === undefined ? "" : boundedText(rawDetail, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH);

  return {
    class: input.class ?? "unknown",
    message: message || boundedText(fallback, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH),
    code,
    retryable: input.retryable ?? described?.retryable ?? null,
    ...(input.class === "usage_limit" &&
    input.resetAt != null &&
    Number.isFinite(Date.parse(input.resetAt))
      ? { resetAt: DateTime.formatIso(DateTime.makeUnsafe(input.resetAt)) }
      : {}),
    ...(detail.length > 0 && detail !== message ? { detail } : {}),
  };
}

function describeCauseSafely(cause: unknown, provider: string): DescribedCause | undefined {
  try {
    return describeCause(cause, provider);
  } catch {
    return undefined;
  }
}

/** The agent's process or connection died mid-turn. */
export function makeProviderCrashFailure(input: {
  readonly driver: ProviderDriverKind | string;
  readonly reason?: string | undefined;
  readonly detail?: string | undefined;
  readonly cause?: unknown;
}): OrchestrationV2ProviderFailure {
  const provider = providerFailureName(input.driver);
  const reason = plainReason(input.reason);
  return makeProviderFailure({
    cause: input.cause,
    driver: input.driver,
    class: "transport_error",
    code: ProviderFailureCode.crashed,
    retryable: true,
    message: `${provider} quit while working${reason === undefined ? "" : ` (${reason})`}. Send the message again to restart it.`,
    detail: input.detail,
  });
}

/**
 * A provider's own error text, read as a reason. HTTP bodies such as
 * `429 {"error":{"message":"..."}}` keep only their message; the full text
 * goes to the detail.
 */
export function readProviderErrorText(text: string): {
  readonly reason: string | undefined;
  readonly status: number | undefined;
} {
  const trimmed = text.trim();
  const statusMatch = /^(\d{3})\b\s*/u.exec(trimmed) ?? /API Error:\s*(\d{3})\b\s*/u.exec(trimmed);
  const status = statusMatch === null ? undefined : Number(statusMatch[1]);
  const body =
    statusMatch === null ? trimmed : trimmed.slice(statusMatch.index + statusMatch[0].length);
  const jsonStart = body.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed: unknown = JSON.parse(body.slice(jsonStart));
      const fromJson = jsonErrorMessage(parsed);
      if (fromJson !== undefined) return { reason: plainReason(fromJson), status };
    } catch {
      // Not JSON after all; read it as text.
    }
  }
  return { reason: plainReason(body.length > 0 ? body : trimmed), status };
}

function jsonErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["detail", "message"] as const) {
    if (typeof record[key] === "string" && record[key].trim().length > 0) return record[key];
  }
  return jsonErrorMessage(record.error);
}

/**
 * Wraps a provider's own error text in a plain sentence. A 429 reads as a usage
 * limit, since that is what every provider means by it.
 */
export function makeNativeProviderFailure(input: {
  readonly driver: ProviderDriverKind | string;
  readonly text: string | null | undefined;
  readonly class?: OrchestrationV2ProviderFailureClass;
  readonly code?: string | null | undefined;
  readonly retryable?: boolean | null;
  readonly provider?: string | undefined;
}): OrchestrationV2ProviderFailure {
  const provider = input.provider ?? providerFailureName(input.driver);
  const text = input.text?.trim();
  if (text === undefined || text.length === 0) {
    return makeProviderFailure({
      driver: input.driver,
      provider,
      class: input.class ?? "provider_error",
      code: input.code,
      retryable: input.retryable ?? null,
    });
  }
  const { reason, status } = readProviderErrorText(text);
  if (status === 429) {
    return makeProviderFailure({
      driver: input.driver,
      provider,
      class: "usage_limit",
      code: input.code ?? "http_429",
      retryable: true,
      message: usageLimitMessage(provider, text),
      detail: text,
    });
  }
  return makeProviderFailure({
    driver: input.driver,
    provider,
    class: input.class ?? "provider_error",
    code: input.code,
    retryable: input.retryable ?? null,
    message:
      reason === undefined
        ? undefined
        : `${provider} reported an error: ${reason}. Send the message again.`,
    detail: text,
  });
}

/** Usage limits keep the provider's own words, which often name the reset time. */
export function usageLimitMessage(provider: string, nativeText?: string | null): string {
  const read = nativeText == null ? undefined : readProviderErrorText(nativeText).reason;
  // Drop a leading "usage limit reached" the provider already said.
  const reason = plainReason(read?.replace(/^.*?\busage limit (?:was )?reached\b[.,:;]?\s*/iu, ""));
  return `${provider} usage limit reached${reason === undefined ? "" : ` (${reason})`}. Switch to another model or provider to keep working now.`;
}

/** The short heading clients show above a failed turn's message. */
export function providerFailureTitle(
  failure: OrchestrationV2ProviderFailure,
  driver: ProviderDriverKind | string | undefined,
): string {
  const provider = providerFailureName(driver, "Agent");
  if (failure.class === "usage_limit") return `${provider} usage limit reached`;
  switch (failure.code) {
    case ProviderFailureCode.sessionOpen:
      return `Couldn't start ${provider}`;
    case ProviderFailureCode.turnStart:
      return `${provider} couldn't start`;
    case ProviderFailureCode.connectionLost:
      return `Lost connection to ${provider}`;
    case ProviderFailureCode.resume:
      return "Couldn't reopen this conversation";
    case ProviderFailureCode.compactUnsupported:
      return "Compaction not supported";
    case ProviderFailureCode.attachmentUnsupported:
      return "Can't send this attachment";
    case ProviderFailureCode.contextTooLong:
      return "Conversation too long for this model";
    case ProviderFailureCode.handoffUncertain:
      return `History may not have reached ${provider}`;
    case ProviderFailureCode.crashed:
      return `${provider} stopped unexpectedly`;
    case ProviderFailureCode.workspaceMissing:
      return "Project folder not found";
    case ProviderFailureCode.instanceMissing:
      return "Agent no longer available";
    case "worktree_not_recreated":
      return "Couldn't restore this thread's worktree";
    case "oom_kill":
      return "Agent ran out of memory";
    case "queued_start_failed":
    case "context_handoff_unsupported":
      return "Queued message couldn't start";
    case "run_preparation_failed":
      return "Couldn't start the agent";
    default:
      return `${provider} stopped with an error`;
  }
}

export function makeProviderFailureTurnItem(input: {
  readonly driver: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly nodeId: NodeId | null;
  readonly providerThreadId: ProviderThreadId;
  readonly providerTurnId: ProviderTurnId;
  readonly itemOrdinal: number;
  readonly failure: OrchestrationV2ProviderFailure;
  readonly retry?: OrchestrationV2ProviderRetry;
  readonly retryStartedAt?: DateTime.Utc;
  readonly occurredAt: DateTime.Utc;
}): Extract<OrchestrationV2TurnItem, { readonly type: "error" }> {
  return {
    id: IdAllocator.derive.turnItemFromProviderItem({
      driver: input.driver,
      nativeItemId: `terminal-failure:${input.providerTurnId}`,
    }),
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.nodeId,
    providerThreadId: input.providerThreadId,
    providerTurnId: input.providerTurnId,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.itemOrdinal,
    status: "failed",
    title: providerFailureTitle(input.failure, input.driver),
    startedAt: input.retryStartedAt ?? input.occurredAt,
    completedAt: input.occurredAt,
    updatedAt: input.occurredAt,
    type: "error",
    failure: input.failure,
    ...(input.retry === undefined ? {} : { retry: input.retry }),
  };
}

export function makeProviderRetryTurnItem(input: {
  readonly driver: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly nodeId: NodeId | null;
  readonly providerThreadId: ProviderThreadId;
  readonly providerTurnId: ProviderTurnId;
  readonly itemOrdinal: number;
  readonly failure: OrchestrationV2ProviderFailure;
  readonly retry: OrchestrationV2ProviderRetry;
  readonly status: Extract<
    OrchestrationV2TurnItem["status"],
    "running" | "completed" | "failed" | "interrupted" | "cancelled"
  >;
  readonly startedAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
}): Extract<OrchestrationV2TurnItem, { readonly type: "error" }> {
  const completed = input.status !== "running";
  let title = "Provider retry";
  if (input.status === "completed") {
    title = "Provider recovered";
  } else if (input.status === "failed") {
    title = providerFailureTitle(input.failure, input.driver);
  } else if (input.status === "interrupted" || input.status === "cancelled") {
    title = "Provider retry stopped";
  }
  return {
    id: IdAllocator.derive.turnItemFromProviderItem({
      driver: input.driver,
      nativeItemId: `terminal-failure:${input.providerTurnId}`,
    }),
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.nodeId,
    providerThreadId: input.providerThreadId,
    providerTurnId: input.providerTurnId,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.itemOrdinal,
    status: input.status,
    title,
    startedAt: input.startedAt,
    completedAt: completed ? input.updatedAt : null,
    updatedAt: input.updatedAt,
    type: "error",
    failure: input.failure,
    retry: input.retry,
  };
}
