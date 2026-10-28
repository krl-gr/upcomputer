import { EnvironmentAuthInvalidError } from "@t3tools/contracts";
import {
  RelayAuthInvalidError,
  RelayEnvironmentConnectNotAuthorizedError,
  RelayEnvironmentEndpointTimedOutError,
} from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";

import {
  mapManagedRelayError,
  mapRemoteDpopEnvironmentError,
  mapRemoteEnvironmentError,
} from "./errors.ts";
import { DPOP_RETRY_HINT, DPOP_UNKNOWN_HINT } from "../relay/errorPresentation.ts";
import { ManagedRelayRequestFailedError } from "../relay/managedRelay.ts";
import { NETWORK_BLOCKING_HINT } from "../errors/network.ts";
import { RemoteEnvironmentAuthFetchError, RemoteEnvironmentAuthTimeoutError } from "../rpc/http.ts";

describe("mapManagedRelayError", () => {
  it("keeps a timeout reported by the relay distinct from a local network failure", () => {
    const relayError = new RelayEnvironmentEndpointTimedOutError({
      code: "environment_endpoint_timed_out",
      traceId: "trace-server-timeout",
    });
    const mapped = mapManagedRelayError(
      new ManagedRelayRequestFailedError({
        action: "connect relay environment",
        cause: relayError,
        relayError,
      }),
    );
    expect(mapped).toMatchObject({
      reason: "timeout",
      detail:
        "That computer didn't answer in time. Make sure it's on, awake and running Up.computer, then try again.",
      traceId: "trace-server-timeout",
    });
  });

  it("retries a tunnel that is still being set up, and blocks other refusals", () => {
    const mapConnectRefusal = (reason: RelayEnvironmentConnectNotAuthorizedError["reason"]) => {
      const relayError = new RelayEnvironmentConnectNotAuthorizedError({
        code: "environment_connect_not_authorized",
        reason,
        traceId: "trace-connect-refused",
      });
      return mapManagedRelayError(
        new ManagedRelayRequestFailedError({
          action: "connect relay environment",
          cause: relayError,
          relayError,
        }),
      );
    };

    expect(mapConnectRefusal("managed_endpoint_allocation_not_ready")).toMatchObject({
      _tag: "ConnectionTransientError",
      reason: "endpoint-unavailable",
      detail:
        "That computer's UpComputer Connect access is still being set up. Try again in a minute.",
      traceId: "trace-connect-refused",
    });
    expect(mapConnectRefusal("endpoint_provider_not_managed")).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "permission",
      detail: expect.stringContaining("turn UpComputer Connect on"),
    });
    expect(mapConnectRefusal(undefined)).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "permission",
    });
  });

  it("presents clock skew as one possible cause for a generic DPoP error", () => {
    const mapped = mapManagedRelayError(
      new ManagedRelayRequestFailedError({
        action: "connect relay environment",
        cause: new Error("request failed"),
        relayError: new RelayAuthInvalidError({
          code: "auth_invalid",
          reason: "invalid_dpop",
          traceId: "trace-1",
        }),
        traceId: "trace-1",
      }),
    );

    expect(mapped).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "authentication",
      detail: `UpComputer Connect didn't accept this device's sign-in. ${DPOP_UNKNOWN_HINT}`,
      traceId: "trace-1",
    });
  });

  it("uses a neutral hint when the relay identifies a non-clock DPoP error", () => {
    const mapped = mapManagedRelayError(
      new ManagedRelayRequestFailedError({
        action: "connect relay environment",
        cause: new Error("request failed"),
        relayError: new RelayAuthInvalidError({
          code: "auth_invalid",
          reason: "invalid_dpop",
          dpopFailureReason: "key_mismatch",
          traceId: "trace-1",
        }),
      }),
    );

    expect(mapped.message).toBe(
      `UpComputer Connect didn't accept this device's sign-in. ${DPOP_RETRY_HINT}`,
    );
  });
});

describe("mapRemoteDpopEnvironmentError", () => {
  it("keeps relay descriptor auth failures distinct from DPoP proof failures", () => {
    const error = new EnvironmentAuthInvalidError({
      code: "auth_invalid",
      reason: "invalid_credential",
      traceId: "trace-descriptor",
    });
    expect(mapRemoteEnvironmentError(error, "relay").message).toBe(
      "this device's access to it was removed or has expired. Pair this device again in Settings, Connections",
    );
    expect(mapRemoteDpopEnvironmentError(error).message).toBe(
      `That computer didn't accept this device's sign-in. ${DPOP_UNKNOWN_HINT}`,
    );
  });

  it.each([
    new RemoteEnvironmentAuthFetchError({
      message: "Failed to fetch remote environment endpoint.",
      cause: new TypeError("Failed to fetch"),
    }),
    new RemoteEnvironmentAuthTimeoutError("https://environment.example.test", 10_000),
  ])("suggests another network when the relay endpoint cannot be reached: $_tag", (error) => {
    const mapped = mapRemoteDpopEnvironmentError(error);
    expect(mapped).toMatchObject({
      _tag: "ConnectionTransientError",
      detail: `${error.message} ${NETWORK_BLOCKING_HINT}`,
    });
  });

  it("does not present a generic environment auth error as confirmed clock skew", () => {
    const mapped = mapRemoteDpopEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace-1",
      }),
    );

    expect(mapped.message).toBe(
      `That computer didn't accept this device's sign-in. ${DPOP_UNKNOWN_HINT}`,
    );
  });

  it("uses a neutral hint for a non-clock DPoP error from a new server", () => {
    const mapped = mapRemoteDpopEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        dpopFailureReason: "key_mismatch",
        traceId: "trace-1",
      }),
    );

    expect(mapped.message).toBe(
      `That computer didn't accept this device's sign-in. ${DPOP_RETRY_HINT}`,
    );
  });
});
