import type {
  OrchestrationV2ProviderFailure,
  OrchestrationV2ProviderFailureClass,
} from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import * as Schema from "effect/Schema";

import { CursorAgentSdkRunnerError } from "./CursorAgentSdk.ts";
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

const isCursorAgentSdkRunnerError = Schema.is(CursorAgentSdkRunnerError);

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
}): OrchestrationV2ProviderFailure {
  const code = input.reason?.code?.trim() || undefined;
  // ConnectError messages repeat their code as a `[resource_exhausted] ` prefix.
  const detail = input.reason?.message.replace(/^\[[a-z_]+\]\s*/, "").trim() || undefined;
  if ((code !== undefined && usageLimitCodes.has(code)) || usageLimitText.test(detail ?? "")) {
    const model = input.model === "auto" || input.model === "default" ? "" : ` for ${input.model}`;
    return makeProviderFailure({
      class: "usage_limit",
      message: `Cursor usage limit reached${model}. Switch model or try again later.${
        detail === undefined ? "" : ` Cursor says: ${detail}`
      }`,
      code: code ?? null,
    });
  }
  return makeProviderFailure({ class: input.class, message: detail, code: code ?? null });
}
