import { LegacyEnvironmentDescriptorPath } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "./endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "../rpc/http.ts";

const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;

export const fetchRemoteEnvironmentDescriptor = Effect.fn(
  "clientRuntime.environment.fetchRemoteEnvironmentDescriptor",
)(function* (input: { readonly httpBaseUrl: string; readonly timeoutMs?: number }) {
  const client = yield* makeEnvironmentHttpApiClient(input.httpBaseUrl);
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/.well-known/upcomputer/environment"),
    input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
    client.metadata.descriptor(),
  ).pipe(
    Effect.catchTag("RemoteEnvironmentAuthUndeclaredStatusError", (error) =>
      error.status === 404
        ? executeEnvironmentHttpRequest(
            environmentEndpointUrl(input.httpBaseUrl, LegacyEnvironmentDescriptorPath),
            input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
            client.metadata.legacyDescriptor(),
          )
        : Effect.fail(error),
    ),
  );
});
