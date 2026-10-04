import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadDetailSnapshot,
} from "@upcomputer/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";
import type { HttpClient } from "effect/unstable/http";

import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import {
  ConnectionTransientError,
  RelayConnectionTarget,
  type PreparedConnection,
  type PreparedHttpAuthorization,
} from "../connection/model.ts";
import { ManagedRelayDpopSigner, type ManagedRelayDpopProofInput } from "../relay/managedRelay.ts";
import { remoteHttpClientLayer, type RemoteEnvironmentRequestError } from "../rpc/http.ts";
import {
  fetchEnvironmentShellSnapshot,
  ShellSnapshotLoader,
  shellSnapshotLoaderLayer,
} from "./shellSnapshotHttp.ts";
import { fetchEnvironmentThreadSnapshot } from "./threadSnapshotHttp.ts";

const TARGET = new RelayConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
});
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: "https://previous.example.test",
  socketUrl: "wss://previous.example.test/ws",
  httpAuthorization: { _tag: "Dpop", accessToken: "expired-token", expiresAtEpochMs: 0 },
  target: TARGET,
};
const CURRENT_ORIGIN = "https://current.example.test";
const RENEWED_ORIGIN = "https://renewed.example.test";
const SHELL = {
  snapshotSequence: 1,
  projects: [],
  threads: [],
  updatedAt: "2026-09-04T00:00:00.000Z",
} satisfies OrchestrationShellSnapshot;
const THREAD = {
  snapshotSequence: 2,
  thread: {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    linkedProjectIds: [],
    contextBindings: [],
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  },
} satisfies OrchestrationThreadDetailSnapshot;

function credentialRejectedResponse(reason = "invalid_credential") {
  return Response.json(
    {
      _tag: "EnvironmentAuthInvalidError",
      code: "auth_invalid",
      reason,
      traceId: "trace-rejected",
    },
    { status: 401 },
  );
}

function makeHarness(reply: (requestNumber: number) => Response | Promise<Response>) {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const authorizations: Array<
    Parameters<RemoteEnvironmentAuthorization["Service"]["authorizeDpopHttp"]>[0]
  > = [];
  const proofs: Array<ManagedRelayDpopProofInput> = [];
  const remoteAuthorization = RemoteEnvironmentAuthorization.of({
    authorizeBearer: () => Effect.die("Unexpected bearer connection preparation."),
    authorizeDpop: () => Effect.die("HTTP requests must not prepare a WebSocket connection."),
    authorizeDpopHttp: (input) =>
      Effect.sync(() => {
        authorizations.push(input);
        const rejected = input.rejectedAccessToken !== undefined;
        return {
          environmentId: TARGET.environmentId,
          label: TARGET.label,
          httpBaseUrl: rejected ? RENEWED_ORIGIN : CURRENT_ORIGIN,
          httpAuthorization: {
            _tag: "Dpop" as const,
            accessToken: rejected ? "renewed-token" : "current-token",
            expiresAtEpochMs: 3_600_000,
          },
        };
      }),
  });
  const signer = ManagedRelayDpopSigner.of({
    thumbprint: Effect.succeed("test-thumbprint"),
    createProof: (input) =>
      Effect.sync(() => {
        proofs.push(input);
        return `proof-${proofs.length}`;
      }),
  });
  const fetchFn: typeof fetch = async (request, init) => {
    calls.push({ url: String(request), init: init ?? {} });
    return reply(calls.length);
  };
  return {
    calls,
    authorizations,
    proofs,
    remoteAuthorization,
    input: {
      prepared: PREPARED,
      signer: Option.some(signer),
      remoteAuthorization: Option.some(remoteAuthorization),
    },
    httpLayer: remoteHttpClientLayer(fetchFn),
  };
}

type HttpInput = ReturnType<typeof makeHarness>["input"];
const LOADERS: ReadonlyArray<{
  readonly name: string;
  readonly path: string;
  readonly response: unknown;
  readonly load: (
    input: HttpInput,
  ) => Effect.Effect<unknown, RemoteEnvironmentRequestError, HttpClient.HttpClient>;
}> = [
  {
    name: "shell snapshot",
    path: "/api/orchestration/shell",
    response: SHELL,
    load: fetchEnvironmentShellSnapshot,
  },
  {
    name: "thread snapshot",
    path: "/api/orchestration/threads/thread-1",
    response: THREAD,
    load: (input: HttpInput) =>
      fetchEnvironmentThreadSnapshot({ ...input, threadId: THREAD.thread.id }),
  },
];

const SHELL_PATH = "/api/orchestration/shell";

describe("authenticated environment HTTP requests", () => {
  it.effect.each(LOADERS)("uses current relay authorization and endpoint for $name", (loader) =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json(loader.response));
      const result = yield* loader.load(harness.input).pipe(Effect.provide(harness.httpLayer));

      expect(result).toEqual(loader.response);
      expect(harness.calls).toHaveLength(1);
      const call = harness.calls[0]!;
      const url = new URL(call.url);
      expect(url.origin).toBe(CURRENT_ORIGIN);
      expect(url.pathname).toBe(loader.path);
      expect(call.init.method).toBe("GET");
      expect(new Headers(call.init.headers).get("authorization")).toBe("DPoP current-token");
      expect(new Headers(call.init.headers).get("dpop")).toBe("proof-1");
      expect(call.init.credentials).toBeUndefined();
      expect(harness.authorizations).toEqual([{ expectedEnvironmentId: TARGET.environmentId }]);
      expect(harness.proofs).toEqual([
        {
          method: "GET",
          url: `${CURRENT_ORIGIN}${loader.path}`,
          accessToken: "current-token",
        },
      ]);
      expect(PREPARED.httpAuthorization).toMatchObject({ accessToken: "expired-token" });
    }),
  );

  it.effect("retries a rejected request once with a new token, endpoint, and proof", () =>
    Effect.gen(function* () {
      const harness = makeHarness((requestNumber) =>
        requestNumber === 1 ? credentialRejectedResponse() : Response.json(SHELL),
      );
      const result = yield* fetchEnvironmentShellSnapshot(harness.input).pipe(
        Effect.provide(harness.httpLayer),
      );

      expect(result).toEqual(SHELL);
      expect(harness.authorizations).toEqual([
        { expectedEnvironmentId: TARGET.environmentId },
        { expectedEnvironmentId: TARGET.environmentId, rejectedAccessToken: "current-token" },
      ]);
      expect(harness.calls.map((call) => call.url)).toEqual([
        `${CURRENT_ORIGIN}${SHELL_PATH}`,
        `${RENEWED_ORIGIN}${SHELL_PATH}`,
      ]);
      expect(
        harness.calls.map((call) => new Headers(call.init.headers).get("authorization")),
      ).toEqual(["DPoP current-token", "DPoP renewed-token"]);
      expect(harness.calls.map((call) => new Headers(call.init.headers).get("dpop"))).toEqual([
        "proof-1",
        "proof-2",
      ]);
      expect(harness.proofs[1]).toEqual({
        method: "GET",
        url: `${RENEWED_ORIGIN}${SHELL_PATH}`,
        accessToken: "renewed-token",
      });
    }),
  );

  it.effect("uses the authorization service captured by the shell loader layer", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json(SHELL));
      const loaderLayer = shellSnapshotLoaderLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            harness.httpLayer,
            Layer.succeed(ManagedRelayDpopSigner, Option.getOrThrow(harness.input.signer)),
            Layer.succeed(RemoteEnvironmentAuthorization, harness.remoteAuthorization),
          ),
        ),
      );
      const loader = yield* ShellSnapshotLoader.pipe(Effect.provide(loaderLayer));
      const result = yield* loader.load(PREPARED);

      expect(result).toEqual(Option.some(SHELL));
      expect(new Headers(harness.calls[0]!.init.headers).get("authorization")).toBe(
        "DPoP current-token",
      );
    }),
  );

  it.effect("preserves the credential rejection after the one recovery attempt fails", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => credentialRejectedResponse());
      const error = yield* fetchEnvironmentShellSnapshot(harness.input).pipe(
        Effect.provide(harness.httpLayer),
        Effect.flip,
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentAuthInvalidError",
        reason: "invalid_credential",
        traceId: "trace-rejected",
      });
      expect(harness.calls).toHaveLength(2);
      expect(harness.authorizations).toHaveLength(2);
    }),
  );

  it.effect.each([
    {
      name: "insufficient scope",
      reply: () =>
        Response.json(
          {
            _tag: "EnvironmentScopeRequiredError",
            code: "insufficient_scope",
            requiredScope: "orchestration:read",
            traceId: "trace-scope",
          },
          { status: 403 },
        ),
      errorTag: "EnvironmentScopeRequiredError",
    },
    {
      name: "missing credential",
      reply: () => credentialRejectedResponse("missing_credential"),
      errorTag: "EnvironmentAuthInvalidError",
    },
    {
      name: "network failure",
      reply: () => Promise.reject(new Error("Network unreachable")),
      errorTag: "RemoteEnvironmentAuthFetchError",
    },
  ])("does not renew or retry on $name", ({ reply, errorTag }) =>
    Effect.gen(function* () {
      const harness = makeHarness(reply);
      const error = yield* fetchEnvironmentShellSnapshot(harness.input).pipe(
        Effect.provide(harness.httpLayer),
        Effect.flip,
      );

      expect(error._tag).toBe(errorTag);
      expect(harness.calls).toHaveLength(1);
      expect(harness.authorizations).toEqual([{ expectedEnvironmentId: TARGET.environmentId }]);
    }),
  );

  it.effect.each([
    { name: "cookie", authorization: null },
    { name: "bearer", authorization: { _tag: "Bearer", token: "bearer-token" } },
  ] satisfies ReadonlyArray<{ name: string; authorization: PreparedHttpAuthorization | null }>)(
    "leaves $name requests unchanged without relay services",
    ({ authorization }) =>
      Effect.gen(function* () {
        const harness = makeHarness(() => Response.json(SHELL));
        const result = yield* fetchEnvironmentShellSnapshot({
          prepared: { ...PREPARED, httpAuthorization: authorization },
          signer: Option.none(),
        }).pipe(Effect.provide(harness.httpLayer));

        expect(result).toEqual(SHELL);
        expect(harness.calls).toHaveLength(1);
        expect(harness.authorizations).toEqual([]);
        expect(new Headers(harness.calls[0]!.init.headers).get("authorization")).toBe(
          authorization === null ? null : "Bearer bearer-token",
        );
        expect(harness.calls[0]!.init.credentials).toBe(
          authorization === null ? "include" : undefined,
        );
      }),
  );

  it.effect("keeps the caller's timeout while waiting for renewal", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json(SHELL));
      const authorizing = yield* Deferred.make<void>();
      const remoteAuthorization = RemoteEnvironmentAuthorization.of({
        ...harness.remoteAuthorization,
        authorizeDpopHttp: () =>
          Deferred.succeed(authorizing, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const pending = yield* fetchEnvironmentShellSnapshot({
        ...harness.input,
        remoteAuthorization: Option.some(remoteAuthorization),
        timeoutMs: 100,
      }).pipe(Effect.provide(harness.httpLayer), Effect.flip, Effect.forkChild);
      yield* Deferred.await(authorizing);
      yield* TestClock.adjust(100);

      expect(yield* Fiber.join(pending)).toMatchObject({
        _tag: "RemoteEnvironmentAuthTimeoutError",
        requestUrl: `${PREPARED.httpBaseUrl}${SHELL_PATH}`,
        timeoutMs: 100,
      });
      expect(harness.calls).toEqual([]);
    }),
  );

  it.effect("reports the current endpoint when the total timeout expires during HTTP", () =>
    Effect.gen(function* () {
      const requested = Promise.withResolvers<void>();
      const response = Promise.withResolvers<Response>();
      const harness = makeHarness(() => {
        requested.resolve();
        return response.promise;
      });
      const authorizing = yield* Deferred.make<void>();
      const authorize = yield* Deferred.make<void>();
      const remoteAuthorization = RemoteEnvironmentAuthorization.of({
        ...harness.remoteAuthorization,
        authorizeDpopHttp: (input) =>
          Deferred.succeed(authorizing, undefined).pipe(
            Effect.andThen(Deferred.await(authorize)),
            Effect.andThen(harness.remoteAuthorization.authorizeDpopHttp(input)),
          ),
      });
      const pending = yield* fetchEnvironmentShellSnapshot({
        ...harness.input,
        remoteAuthorization: Option.some(remoteAuthorization),
        timeoutMs: 100,
      }).pipe(Effect.provide(harness.httpLayer), Effect.flip, Effect.forkChild);
      yield* Deferred.await(authorizing);
      yield* TestClock.adjust(25);
      yield* Deferred.succeed(authorize, undefined);
      yield* Effect.promise(() => requested.promise);
      yield* TestClock.adjust(75);

      expect(yield* Fiber.join(pending)).toMatchObject({
        _tag: "RemoteEnvironmentAuthTimeoutError",
        requestUrl: `${CURRENT_ORIGIN}${SHELL_PATH}`,
        timeoutMs: 100,
      });
      expect(harness.calls.map((call) => call.url)).toEqual([`${CURRENT_ORIGIN}${SHELL_PATH}`]);
      expect(harness.authorizations).toHaveLength(1);
      response.resolve(Response.json(SHELL));
    }),
  );

  it.effect("reports renewal failure without sending the expired prepared token", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json(SHELL));
      const failure = new ConnectionTransientError({
        reason: "transport",
        detail: "Relay unavailable",
      });
      const remoteAuthorization = RemoteEnvironmentAuthorization.of({
        ...harness.remoteAuthorization,
        authorizeDpopHttp: () => Effect.fail(failure),
      });
      const error = yield* fetchEnvironmentShellSnapshot({
        ...harness.input,
        remoteAuthorization: Option.some(remoteAuthorization),
      }).pipe(Effect.provide(harness.httpLayer), Effect.flip);

      expect(error).toMatchObject({
        _tag: "RemoteEnvironmentAuthFetchError",
        message: "Could not authorize the environment request.",
        cause: failure,
      });
      expect(harness.calls).toEqual([]);
      expect(harness.proofs).toEqual([]);
    }),
  );

  it.effect("does not fall back to a captured DPoP token when authorization is unavailable", () =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json(SHELL));
      const error = yield* fetchEnvironmentShellSnapshot({
        prepared: PREPARED,
        signer: harness.input.signer,
      }).pipe(Effect.provide(harness.httpLayer), Effect.flip);

      expect(error).toMatchObject({
        _tag: "RemoteEnvironmentAuthFetchError",
        message: "No relay authorization service is available for the environment request.",
      });
      expect(harness.calls).toEqual([]);
    }),
  );
});
