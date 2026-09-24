import { assert, it, vi } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import * as BitbucketApi from "./BitbucketApi.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";

const repositoryJson = {
  full_name: "pingdotgg/t3code",
  links: {
    html: { href: "https://bitbucket.org/pingdotgg/t3code" },
    clone: [
      { name: "https", href: "https://bitbucket.org/pingdotgg/t3code.git" },
      { name: "ssh", href: "git@bitbucket.org:pingdotgg/t3code.git" },
    ],
  },
};

function makeLayer(input: {
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly requestFailure?: (
    request: HttpClientRequest.HttpClientRequest,
  ) => HttpClientError.HttpClientError;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    input.requestFailure
      ? Effect.fail(input.requestFailure(request))
      : Effect.succeed(HttpClientResponse.fromWeb(request, input.response(request))),
  );
  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: [
          {
            name: "origin",
            url: "git@bitbucket.org:pingdotgg/t3code.git",
            pushUrl: Option.none(),
            isPrimary: true,
          },
        ],
        freshness: {
          source: "live-local" as const,
          observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriver["Service"]>;

  const layer = BitbucketApi.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => execute(request)),
      ),
    ),
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        resolve: () =>
          Effect.succeed({
            kind: "git",
            repository: {
              kind: "git",
              rootPath: "/repo",
              metadataPath: null,
              freshness: {
                source: "live-local" as const,
                observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
                expiresAt: Option.none(),
              },
            },
            driver: driver as unknown as VcsDriver.VcsDriver["Service"],
          }),
      }),
    ),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            UPCOMPUTER_BITBUCKET_API_BASE_URL: "https://api.test.local/2.0",
            UPCOMPUTER_BITBUCKET_EMAIL: "user@example.com",
            UPCOMPUTER_BITBUCKET_API_TOKEN: "token",
          },
        }),
      ),
    ),
  );

  return { execute, layer };
}

it.effect("reads repository clone URLs", () => {
  const { layer } = makeLayer({
    response: () => Response.json(repositoryJson),
  });

  return Effect.gen(function* () {
    const bitbucket = yield* BitbucketApi.BitbucketApi;
    const cloneUrls = yield* bitbucket.getRepositoryCloneUrls({
      cwd: "/repo",
      repository: "pingdotgg/t3code",
    });
    assert.deepStrictEqual(cloneUrls, {
      nameWithOwner: "pingdotgg/t3code",
      url: "https://bitbucket.org/pingdotgg/t3code.git",
      sshUrl: "git@bitbucket.org:pingdotgg/t3code.git",
    });
  }).pipe(Effect.provide(layer));
});

it.effect("creates repositories through the Bitbucket REST API", () => {
  const { execute, layer } = makeLayer({
    response: () => Response.json(repositoryJson),
  });

  return Effect.gen(function* () {
    const bitbucket = yield* BitbucketApi.BitbucketApi;
    const cloneUrls = yield* bitbucket.createRepository({
      cwd: "/repo",
      repository: "pingdotgg/t3code",
      visibility: "private",
    });

    assert.deepStrictEqual(cloneUrls, {
      nameWithOwner: "pingdotgg/t3code",
      url: "https://bitbucket.org/pingdotgg/t3code.git",
      sshUrl: "git@bitbucket.org:pingdotgg/t3code.git",
    });

    const request = execute.mock.calls[0]?.[0];
    assert.strictEqual(request?.url, "https://api.test.local/2.0/repositories/pingdotgg/t3code");
    assert.strictEqual(request?.method, "POST");
    assert.ok(request);
    const rawBody = (request.body as { readonly body?: Uint8Array }).body;
    assert.ok(rawBody);
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(rawBody)), {
      scm: "git",
      is_private: true,
    });
  }).pipe(Effect.provide(layer));
});

it.effect("reports auth status through the Bitbucket REST /user endpoint", () => {
  const { layer } = makeLayer({
    response: () => Response.json({ username: "bitbucket-user" }),
  });

  return Effect.gen(function* () {
    const bitbucket = yield* BitbucketApi.BitbucketApi;
    const auth = yield* bitbucket.probeAuth;

    assert.deepStrictEqual(auth, {
      status: "authenticated",
      account: Option.some("bitbucket-user"),
      host: Option.some("bitbucket.org"),
      detail: Option.none(),
    });
  }).pipe(Effect.provide(layer));
});

it.effect("preserves the HTTP client failure without deriving the domain message from it", () => {
  const transportCause = new Error("socket reset by peer");
  let requestFailure: HttpClientError.HttpClientError | undefined;
  const { layer } = makeLayer({
    response: () => Response.json({}),
    requestFailure: (request) => {
      requestFailure = new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          cause: transportCause,
        }),
      });
      return requestFailure;
    },
  });

  return Effect.gen(function* () {
    const bitbucket = yield* BitbucketApi.BitbucketApi;
    const error = yield* Effect.flip(
      bitbucket.getRepositoryCloneUrls({
        cwd: "/repo",
        repository: "pingdotgg/t3code",
      }),
    );

    assert.instanceOf(error, BitbucketApi.BitbucketRequestError);
    assert.strictEqual(error.operation, "getRepository");
    assert.strictEqual(
      error.message,
      "Bitbucket API failed in getRepository: Failed to send the Bitbucket request.",
    );
    assert.strictEqual(error.cause, requestFailure);
    assert.strictEqual(requestFailure?.cause, transportCause);
  }).pipe(Effect.provide(layer));
});

it.effect("keeps Bitbucket response bodies out of diagnostics", () => {
  const responseBody = '{"error":{"message":"credential=secret-value"}}';
  const { layer } = makeLayer({
    response: () => new Response(responseBody, { status: 403 }),
  });

  return Effect.gen(function* () {
    const bitbucket = yield* BitbucketApi.BitbucketApi;
    const error = yield* bitbucket
      .getRepositoryCloneUrls({ cwd: "/repo", repository: "pingdotgg/t3code" })
      .pipe(Effect.flip);

    assert.instanceOf(error, BitbucketApi.BitbucketResponseError);
    assert.strictEqual(error.operation, "getRepository");
    assert.strictEqual(error.status, 403);
    assert.strictEqual(error.responseBodyLength, responseBody.length);
    assert.notProperty(error, "responseBody");
    assert.strictEqual(
      error.message,
      "Bitbucket API failed in getRepository: Bitbucket returned HTTP 403.",
    );
    assert.notInclude(error.message, "secret-value");
  }).pipe(Effect.provide(layer));
});

it.effect("preserves Bitbucket response body read failures as their immediate cause", () => {
  const cause = new Error("response stream failed");
  const { layer } = makeLayer({
    response: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => controller.error(cause),
        }),
        { status: 502 },
      ),
  });

  return Effect.gen(function* () {
    const bitbucket = yield* BitbucketApi.BitbucketApi;
    const error = yield* bitbucket
      .getRepositoryCloneUrls({ cwd: "/repo", repository: "pingdotgg/t3code" })
      .pipe(Effect.flip);

    assert.instanceOf(error, BitbucketApi.BitbucketResponseBodyReadError);
    assert.strictEqual(error.operation, "getRepository");
    assert.strictEqual(error.status, 502);
    assert.instanceOf(error.cause, HttpClientError.HttpClientError);
    assert.strictEqual(error.cause.cause, cause);
    assert.strictEqual(
      error.message,
      "Bitbucket API failed in getRepository: Bitbucket returned HTTP 502.",
    );
  }).pipe(Effect.provide(layer));
});
