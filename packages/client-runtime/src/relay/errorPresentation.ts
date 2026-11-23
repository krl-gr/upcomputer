import type { DpopFailureReason } from "@t3tools/contracts";
import type { RelayEnvironmentStatusResponse, RelayProtectedError } from "@t3tools/contracts/relay";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { type MarkedText, resolveMarkedText } from "../errors/translatable.ts";

export const DPOP_CLOCK_HINT = msg(
  "Hint: Check that automatic date and time is enabled on both devices, then try again.",
);

/** Older servers omit the DPoP category, but newer servers can also omit it for
 * a credential failure that happens after proof verification. */
export const DPOP_UNKNOWN_HINT = msg(
  "Hint: Try again. If it still fails, clock skew may be the cause; check that automatic date and time is enabled on both devices.",
);

export const DPOP_RETRY_HINT = msg("Hint: Try again. If the problem continues, copy the trace ID.");

function dpopFailureHint(reason: DpopFailureReason | undefined): string {
  if (reason === "time_window") return DPOP_CLOCK_HINT;
  if (reason === undefined) return DPOP_UNKNOWN_HINT;
  return DPOP_RETRY_HINT;
}

export function dpopFailureText(
  message: string,
  reason: DpopFailureReason | undefined,
): MarkedText {
  return [message, dpopFailureHint(reason)];
}

const CLOCK_SYNC_HINT = msg("Sync the date and time in system settings, then try again.");

const STALE_KEY_MESSAGE = msg(
  "That computer needs to reconnect to UpComputer Connect. On that computer, turn UpComputer Connect off and on in Settings, Sharing & access.",
);

const LINK_PROOF_CLOCK_TEXT: MarkedText = [
  msg("UpComputer Connect rejected that computer's link because its clock is probably wrong."),
  CLOCK_SYNC_HINT,
];

const RELAY_PROBLEM_MESSAGE = msg(
  "UpComputer Connect had a problem on our side. Try again in a few minutes, and if it keeps failing, copy the trace ID and contact us.",
);

// The relay tolerates a minute; past that, its checks fail.
const RELAY_CLOCK_TOLERANCE_SECONDS = 60;

const decodeJwtIssuedAt = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ iat: Schema.Finite })),
);

function jwtIssuedAt(token: string): Option.Option<number> {
  const payload = token.split(".")[1];
  if (payload === undefined) return Option.none();
  return Option.flatMap(Result.getSuccess(Base64Url.decodeString(payload)), (json) =>
    Option.map(decodeJwtIssuedAt(json), (claims) => claims.iat),
  );
}

/**
 * How far the environment's clock was off when it signed a link proof: the
 * proof carries its time, the relay challenge inside it was issued moments
 * earlier in relay time. Null when within the relay's tolerance or unknown.
 */
export function environmentLinkClockSkewSeconds(input: {
  readonly challenge: string;
  readonly proof: string;
}): number | null {
  const challengeIssuedAt = jwtIssuedAt(input.challenge);
  const proofIssuedAt = jwtIssuedAt(input.proof);
  if (Option.isNone(challengeIssuedAt) || Option.isNone(proofIssuedAt)) return null;
  const skew = proofIssuedAt.value - challengeIssuedAt.value;
  return Math.abs(skew) > RELAY_CLOCK_TOLERANCE_SECONDS ? skew : null;
}

function environmentClockSkewText(skewSeconds: number): MarkedText {
  const minutes = Math.max(1, Math.round(Math.abs(skewSeconds) / 60));
  return [
    skewSeconds < 0
      ? msg(
          "Relay rejected the environment link proof because the computer's clock is about {minutes, plural, one {{minutes} minute} other {{minutes} minutes}} behind.",
          { minutes },
        )
      : msg(
          "Relay rejected the environment link proof because the computer's clock is about {minutes, plural, one {{minutes} minute} other {{minutes} minutes}} ahead.",
          { minutes },
        ),
    CLOCK_SYNC_HINT,
  ];
}

/**
 * An older environment signs link proofs in its own time, so a wrong clock
 * fails as expired (behind) or as an invalid signature (ahead).
 */
function environmentLinkFailureText(
  error: Parameters<typeof relayRequestFailureText>[0],
  link: { readonly challenge: string; readonly proof: string },
): MarkedText | null {
  const relayError = error.relayError;
  if (
    relayError?._tag === "RelayEnvironmentLinkProofExpiredError" ||
    (relayError?._tag === "RelayEnvironmentLinkProofInvalidError" &&
      relayError.reason === "invalid_signature_or_scope")
  ) {
    const skew = environmentLinkClockSkewSeconds(link);
    if (skew !== null) return environmentClockSkewText(skew);
  }
  return relayRequestFailureText(error);
}

export function environmentLinkFailureDetail(
  error: Parameters<typeof relayRequestFailureText>[0],
  link: { readonly challenge: string; readonly proof: string },
  resolve: MFunctionType = mFallback,
): string | null {
  const text = environmentLinkFailureText(error, link);
  return text === null ? null : resolveMarkedText(text, resolve);
}

/** The relay's refusal as marked sentences, for errors that carry `i18nMessage`. */
export function relayProtectedErrorText(error: RelayProtectedError): MarkedText {
  switch (error._tag) {
    case "RelayAuthInvalidError":
      switch (error.reason) {
        case "missing_bearer":
        case "invalid_bearer":
          return [
            msg(
              "Your UpComputer Connect sign-in is no longer valid. Sign in again, then reconnect.",
            ),
          ];
        case "invalid_dpop":
          return dpopFailureText(
            msg("UpComputer Connect didn't accept this device's sign-in."),
            error.dpopFailureReason,
          );
        case "not_authorized":
          return [
            msg("UpComputer Connect didn't accept this request. Sign in again, then reconnect."),
          ];
      }
    case "RelayEnvironmentLinkProofExpiredError":
      return LINK_PROOF_CLOCK_TEXT;
    case "RelayEnvironmentLinkProofInvalidError":
      return [
        msg(
          "UpComputer Connect couldn't confirm that computer's link. Turn UpComputer Connect off and on again on that computer.",
        ),
      ];
    case "RelayEnvironmentConnectNotAuthorizedError":
      // "Not authorized" covers non-auth causes too; surface the reason so a
      // missing link does not read as a credential problem.
      if (error.reason === "environment_link_not_found") {
        return [
          msg(
            "That computer isn't linked to UpComputer Connect anymore. On that computer, open Settings, Connections and turn UpComputer Connect on again.",
          ),
        ];
      }
      if (error.reason === "managed_endpoint_allocation_not_ready") {
        return [
          msg(
            "That computer's UpComputer Connect access is still being set up. Try again in a minute.",
          ),
        ];
      }
      if (error.reason === "endpoint_provider_not_managed") {
        return [
          msg(
            "This environment is linked only to publish agent activity, so it cannot accept connections. On that computer, open Settings > Sharing & access and turn UpComputer Connect on.",
          ),
        ];
      }
      return [
        msg(
          "UpComputer Connect didn't allow a connection to that computer. Check that you're signed in to the same account on both devices.",
        ),
      ];
    case "RelayEnvironmentEndpointUnavailableError":
      if (error.proofFailure === "key_mismatch") return [STALE_KEY_MESSAGE];
      if (error.proofFailure === "clock_skew") {
        return [
          msg(
            "UpComputer Connect rejected that computer's answer because its clock is probably wrong.",
          ),
          CLOCK_SYNC_HINT,
        ];
      }
      return [
        msg(
          "UpComputer Connect couldn't reach that computer. Make sure it's on, awake and running Up.computer, then try again.",
        ),
      ];
    case "RelayEnvironmentKeyMismatchError":
      return [STALE_KEY_MESSAGE];
    case "RelayEnvironmentEndpointTimedOutError":
      return [
        msg(
          "That computer didn't answer in time. Make sure it's on, awake and running Up.computer, then try again.",
        ),
      ];
    case "RelayEnvironmentLinkFailedError":
      return [msg("UpComputer Connect couldn't link this computer. Try again in a few minutes.")];
    case "RelayEnvironmentLinkUnavailableError":
      return error.provisioningStage
        ? [
            msg(
              "UpComputer Connect couldn't set up access for this computer right now (failed at {stage}). Try again in a few minutes.",
              { stage: error.provisioningStage },
            ),
          ]
        : [
            msg(
              "UpComputer Connect couldn't set up access for this computer right now. Try again in a few minutes.",
            ),
          ];
    case "RelayEnvironmentLinkLimitExceededError":
      return [
        msg(
          "Your account already has its maximum of {maxTunnels} computers on UpComputer Connect. Remove one you don't use, then try again.",
          { maxTunnels: error.maxTunnels },
        ),
      ];
    case "RelayAgentActivityPublishProofExpiredError":
      return [
        msg(
          "UpComputer Connect rejected this computer's activity updates because its clock is probably wrong.",
        ),
        CLOCK_SYNC_HINT,
      ];
    case "RelayAgentActivityPublishProofInvalidError":
      return [
        msg(
          "UpComputer Connect rejected this computer's activity updates. Turn UpComputer Connect off and on again.",
        ),
      ];
    case "RelayWebPushSubscriptionConflictError":
      return [
        msg(
          "Notifications for this device are registered to another UpComputer Connect account. Sign in with that account, or remove this device there.",
        ),
      ];
    case "RelayInternalError":
      return [RELAY_PROBLEM_MESSAGE];
  }
}

export function relayProtectedErrorMessage(
  error: RelayProtectedError,
  resolve: MFunctionType = mFallback,
): string {
  return resolveMarkedText(relayProtectedErrorText(error), resolve);
}

// The relay cuts off a request it cannot finish in time with a 504 that no
// endpoint declares, so the client sees only the status.
export const RELAY_GATEWAY_TIMEOUT_MESSAGE = msg(
  "UpComputer Connect took too long to answer. Try again in a few minutes, and if it keeps failing, copy the trace ID and contact us.",
);

export function relayRequestFailureText(error: {
  readonly relayError?: RelayProtectedError | undefined;
  readonly status?: number | undefined;
}): MarkedText | null {
  if (error.relayError) return relayProtectedErrorText(error.relayError);
  if (error.status === 504) return [RELAY_GATEWAY_TIMEOUT_MESSAGE];
  if (error.status !== undefined) return [RELAY_PROBLEM_MESSAGE];
  return null;
}

export function relayRequestFailureDetail(
  error: {
    readonly relayError?: RelayProtectedError | undefined;
    readonly status?: number | undefined;
  },
  resolve: MFunctionType = mFallback,
): string | null {
  const text = relayRequestFailureText(error);
  return text === null ? null : resolveMarkedText(text, resolve);
}

export function relayOfflineReasonMessage(
  status: Pick<RelayEnvironmentStatusResponse, "offlineReason">,
  resolve: MFunctionType = mFallback,
): string | null {
  switch (status.offlineReason) {
    case "tunnel_released":
      return resolve(
        msg(
          "Offline for a while, so its UpComputer Connect tunnel was removed. Start Up.computer on that computer and update it to the latest version to reconnect.",
        ),
      );
    case undefined:
      return null;
  }
}
