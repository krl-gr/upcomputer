import type {
  OrchestrationV2ProviderFailure,
  OrchestrationV2ProviderFailureClass,
} from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";

import { cursorSdkFailureMessage, isCursorAgentSdkRunnerError } from "./CursorAgentSdk.ts";
import { CursorSdkError } from "./sdk.ts";

export interface CursorFailureReason {
  readonly message: string;
  readonly code?: string | undefined;
}

// aiserver ErrorCode names and Connect codes Cursor uses for exhausted plan usage and rate limits.
const usageLimitCodes = new Set([
  "FREE_USER_RATE_LIMIT_EXCEEDED",
  "PRO_USER_RATE_LIMIT_EXCEEDED",
  "FREE_USER_USAGE_LIMIT",
  "PRO_USER_USAGE_LIMIT",
  "RESOURCE_EXHAUSTED",
  "GENERIC_RATE_LIMIT_EXCEEDED",
  "RATE_LIMITED",
  "RATE_LIMITED_CHANGEABLE",
  "USAGE_PRICING_REQUIRED",
  "USAGE_PRICING_REQUIRED_CHANGEABLE",
  "resource_exhausted",
]);

// Local agent-loop failures reach RunResult.error as `{ message: "<title> <detail>" }` without
// the ErrorCode, so the server's own wording is the only signal left.
const usageLimitText =
  /\b(?:usage|rate|requests?|spend) limit(?:s|ed)?\b|\bhit your\b[^.]*\blimit\b|\btoo many requests\b/i;

/** The SDK's own error under the runner wrapper. Other thrown values are defects and stay generic. */
export function cursorSdkErrorReason(cause: unknown): CursorFailureReason | undefined {
  const error = isCursorAgentSdkRunnerError(cause) ? cause.cause : cause;
  return error instanceof CursorSdkError ? { message: error.message, code: error.code } : undefined;
}

export function cursorRunFailure(input: {
  readonly reason: CursorFailureReason | undefined;
  readonly model: string;
  readonly class: OrchestrationV2ProviderFailureClass;
  readonly cause?: unknown;
}): OrchestrationV2ProviderFailure {
  const code = input.reason?.code?.trim() || undefined;
  const raw = input.reason?.message.trim() || undefined;
  // Transport dumps arrive as `Error: ConnectError: [unavailable] <detail>`, and
  // ConnectError messages repeat their code as a `[resource_exhausted] ` prefix.
  const detail =
    raw
      ?.replace(/^Error:\s*/u, "")
      .replace(/^[A-Za-z]+Error:\s*/u, "")
      .replace(/^\[[a-z_]+\]\s*/u, "")
      .trim() || undefined;
  if ((code !== undefined && usageLimitCodes.has(code)) || usageLimitText.test(detail ?? "")) {
    const model = input.model === "auto" || input.model === "default" ? "" : ` for ${input.model}`;
    // Cursor names its reset date only in prose; keep that sentence visible.
    const resetSentence = /[^.!]*\breset[^.!]*[.!]/iu.exec(detail ?? "")?.[0]?.trim();
    return makeProviderFailure({
      class: "usage_limit",
      driver: CURSOR_DRIVER,
      message: `Cursor usage limit reached${model}.${
        resetSentence === undefined ? "" : ` ${resetSentence}`
      } Switch to another model or provider to keep working now.`,
      code: code ?? null,
      detail: raw,
    });
  }
  const reason = detail?.replace(/[.\s]+$/u, "");
  if (input.class === "transport_error") {
    return makeProviderFailure({
      cause: input.cause,
      class: input.class,
      driver: CURSOR_DRIVER,
      message: `Cursor's servers didn't respond${reason === undefined ? "" : ` (${reason})`}. Check your connection and send again.`,
      code: code ?? null,
      detail: raw,
    });
  }
  return makeProviderFailure({
    cause: input.cause,
    class: input.class,
    driver: CURSOR_DRIVER,
    message:
      reason === undefined
        ? undefined
        : `Cursor reported an error: ${reason}. Send the message again.`,
    code: code ?? null,
    detail: raw,
  });
}

const CURSOR_DRIVER = "cursor";

/**
 * A run the SDK broke. Our reading of Cursor's own errors, including the usage
 * limit, comes first; a runner error without one is read from its SDK message.
 */
export function cursorTransportFailure(
  cause: unknown,
  model: string,
): OrchestrationV2ProviderFailure {
  const reason =
    cursorSdkErrorReason(cause) ??
    (isCursorAgentSdkRunnerError(cause) ? { message: cursorSdkFailureMessage(cause) } : undefined);
  return cursorRunFailure({ reason, model, class: "transport_error", cause });
}
