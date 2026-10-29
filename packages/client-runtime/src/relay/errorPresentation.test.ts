import {
  RelayAuthInvalidError,
  RelayEnvironmentLinkProofExpiredError,
  RelayEnvironmentLinkProofInvalidError,
} from "@t3tools/contracts/relay";
import * as Base64Url from "effect/encoding/Base64Url";
import { describe, expect, it } from "@effect/vitest";

import {
  DPOP_CLOCK_HINT,
  DPOP_RETRY_HINT,
  DPOP_UNKNOWN_HINT,
  environmentLinkClockSkewSeconds,
  environmentLinkFailureDetail,
  relayProtectedErrorMessage,
} from "./errorPresentation.ts";

describe("relayProtectedErrorMessage", () => {
  it("presents clock skew as one possible cause when the relay omits the reason", () => {
    const error = new RelayAuthInvalidError({
      code: "auth_invalid",
      reason: "invalid_dpop",
      traceId: "trace-1",
    });

    expect(relayProtectedErrorMessage(error)).toBe(
      `UpComputer Connect didn't accept this device's sign-in. ${DPOP_UNKNOWN_HINT}`,
    );
  });

  it("keeps the clock hint for a relay that confirms a time-window failure", () => {
    const error = new RelayAuthInvalidError({
      code: "auth_invalid",
      reason: "invalid_dpop",
      dpopFailureReason: "time_window",
      traceId: "trace-1",
    });

    expect(relayProtectedErrorMessage(error)).toContain(DPOP_CLOCK_HINT);
  });

  it("does not blame the clock when the relay identifies another proof failure", () => {
    const error = new RelayAuthInvalidError({
      code: "auth_invalid",
      reason: "invalid_dpop",
      dpopFailureReason: "key_mismatch",
      traceId: "trace-1",
    });

    expect(relayProtectedErrorMessage(error)).toBe(
      `UpComputer Connect didn't accept this device's sign-in. ${DPOP_RETRY_HINT}`,
    );
  });
});

const RELAY_ISSUED_AT = Date.parse("2026-10-25T12:00:00Z") / 1_000;
const jwt = (claims: object) => `e30.${Base64Url.encode(JSON.stringify(claims))}.signature`;
const linkSignedAt = (skewSeconds: number) => {
  const challenge = jwt({ iat: RELAY_ISSUED_AT });
  return { challenge, proof: jwt({ iat: RELAY_ISSUED_AT + 2 + skewSeconds, challenge }) };
};
const expired = new RelayEnvironmentLinkProofExpiredError({
  code: "environment_link_proof_expired",
  traceId: "trace-expired",
});
const invalid = (reason: RelayEnvironmentLinkProofInvalidError["reason"]) =>
  new RelayEnvironmentLinkProofInvalidError({
    code: "environment_link_proof_invalid",
    reason,
    traceId: "trace-invalid",
  });

describe("environmentLinkClockSkewSeconds", () => {
  it("measures the environment clock against the relay challenge it signed", () => {
    expect(environmentLinkClockSkewSeconds(linkSignedAt(-600))).toBe(-598);
    expect(environmentLinkClockSkewSeconds(linkSignedAt(600))).toBe(602);
  });

  it("reports nothing within the relay's tolerance or for unreadable tokens", () => {
    expect(environmentLinkClockSkewSeconds(linkSignedAt(30))).toBeNull();
    expect(environmentLinkClockSkewSeconds({ challenge: "opaque", proof: "opaque" })).toBeNull();
  });
});

describe("environmentLinkFailureDetail", () => {
  it("names the clock and how far off it is when an expired proof was signed behind", () => {
    expect(environmentLinkFailureDetail({ relayError: expired }, linkSignedAt(-600))).toBe(
      "Relay rejected the environment link proof because the computer's clock is about 10 minutes behind. Sync the date and time in system settings, then try again.",
    );
  });

  it("names the clock when a proof signed ahead fails the relay's signature check", () => {
    expect(
      environmentLinkFailureDetail(
        { relayError: invalid("invalid_signature_or_scope") },
        linkSignedAt(600),
      ),
    ).toBe(
      "Relay rejected the environment link proof because the computer's clock is about 10 minutes ahead. Sync the date and time in system settings, then try again.",
    );
  });

  it("still points at the clock for an expired proof when the offset is unknown", () => {
    expect(environmentLinkFailureDetail({ relayError: expired }, linkSignedAt(0))).toBe(
      "UpComputer Connect rejected that computer's link because its clock is probably wrong. Sync the date and time in system settings, then try again.",
    );
  });

  it("does not blame the clock for unrelated link failures", () => {
    expect(
      environmentLinkFailureDetail({ relayError: invalid("replayed_nonce") }, linkSignedAt(600)),
    ).toBe(
      "UpComputer Connect couldn't confirm that computer's link. Turn UpComputer Connect off and on again on that computer.",
    );
    expect(
      environmentLinkFailureDetail(
        { relayError: invalid("invalid_signature_or_scope") },
        linkSignedAt(0),
      ),
    ).toBe(
      "UpComputer Connect couldn't confirm that computer's link. Turn UpComputer Connect off and on again on that computer.",
    );
  });
});
