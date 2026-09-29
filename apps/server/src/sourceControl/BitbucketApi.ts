import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  NonNegativeInt,
  TrimmedNonEmptyString,
  type SourceControlProviderAuth,
  type SourceControlRepositoryCloneUrls,
  type SourceControlRepositoryVisibility,
} from "@upcomputer/contracts";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { detectSourceControlProviderFromRemoteUrl } from "@upcomputer/shared/sourceControl";

import type * as SourceControlProvider from "./SourceControlProvider.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

const DEFAULT_API_BASE_URL = "https://api.bitbucket.org/2.0";

const BitbucketApiEnvConfig = Config.all({
  baseUrl: Config.string("UPCOMPUTER_BITBUCKET_API_BASE_URL").pipe(
    Config.withDefault(DEFAULT_API_BASE_URL),
  ),
  accessToken: Config.string("UPCOMPUTER_BITBUCKET_ACCESS_TOKEN").pipe(Config.option),
  email: Config.string("UPCOMPUTER_BITBUCKET_EMAIL").pipe(Config.option),
  apiToken: Config.string("UPCOMPUTER_BITBUCKET_API_TOKEN").pipe(Config.option),
});

const BitbucketApiOperation = Schema.Literals([
  "resolveRepository",
  "getRepository",
  "createRepository",
  "probeAuth",
]);
type BitbucketApiOperation = typeof BitbucketApiOperation.Type;

export class BitbucketRepositoryLocatorError extends Schema.TaggedErrorClass<BitbucketRepositoryLocatorError>()(
  "BitbucketRepositoryLocatorError",
  {
    repository: Schema.String,
  },
) {
  override get message(): string {
    return "Bitbucket API failed in createRepository: Bitbucket repositories must be specified as workspace/repository.";
  }
}

export class BitbucketRequestError extends Schema.TaggedErrorClass<BitbucketRequestError>()(
  "BitbucketRequestError",
  {
    operation: BitbucketApiOperation,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Bitbucket API failed in ${this.operation}: Failed to send the Bitbucket request.`;
  }
}

export class BitbucketResponseError extends Schema.TaggedErrorClass<BitbucketResponseError>()(
  "BitbucketResponseError",
  {
    operation: BitbucketApiOperation,
    status: Schema.Int,
    responseBodyLength: NonNegativeInt,
  },
) {
  override get message(): string {
    return `Bitbucket API failed in ${this.operation}: Bitbucket returned HTTP ${this.status}.`;
  }
}

export class BitbucketResponseBodyReadError extends Schema.TaggedErrorClass<BitbucketResponseBodyReadError>()(
  "BitbucketResponseBodyReadError",
  {
    operation: BitbucketApiOperation,
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Bitbucket API failed in ${this.operation}: Bitbucket returned HTTP ${this.status}.`;
  }
}

export class BitbucketResponseDecodeError extends Schema.TaggedErrorClass<BitbucketResponseDecodeError>()(
  "BitbucketResponseDecodeError",
  {
    operation: BitbucketApiOperation,
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Bitbucket API failed in ${this.operation}: Bitbucket returned invalid JSON for the requested resource.`;
  }
}

export class BitbucketRepositoryVcsResolveError extends Schema.TaggedErrorClass<BitbucketRepositoryVcsResolveError>()(
  "BitbucketRepositoryVcsResolveError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Bitbucket API failed in resolveRepository: Failed to resolve VCS repository for ${this.cwd}.`;
  }
}

export class BitbucketRepositoryRemotesListError extends Schema.TaggedErrorClass<BitbucketRepositoryRemotesListError>()(
  "BitbucketRepositoryRemotesListError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Bitbucket API failed in resolveRepository: Failed to list remotes for ${this.cwd}.`;
  }
}

export class BitbucketRepositoryRemoteNotFoundError extends Schema.TaggedErrorClass<BitbucketRepositoryRemoteNotFoundError>()(
  "BitbucketRepositoryRemoteNotFoundError",
  {
    cwd: Schema.String,
  },
) {
  override get message(): string {
    return `Bitbucket API failed in resolveRepository: No Bitbucket repository remote was detected for ${this.cwd}.`;
  }
}

export const BitbucketApiError = Schema.Union([
  BitbucketRepositoryLocatorError,
  BitbucketRequestError,
  BitbucketResponseError,
  BitbucketResponseBodyReadError,
  BitbucketResponseDecodeError,
  BitbucketRepositoryVcsResolveError,
  BitbucketRepositoryRemotesListError,
  BitbucketRepositoryRemoteNotFoundError,
]);
export type BitbucketApiError = typeof BitbucketApiError.Type;
export const isBitbucketApiError = Schema.is(BitbucketApiError);

const RawBitbucketRepositorySchema = Schema.Struct({
  full_name: TrimmedNonEmptyString,
  links: Schema.Struct({
    html: Schema.optional(
      Schema.Struct({
        href: TrimmedNonEmptyString,
      }),
    ),
    clone: Schema.optional(
      Schema.Array(
        Schema.Struct({
          name: TrimmedNonEmptyString,
          href: TrimmedNonEmptyString,
        }),
      ),
    ),
  }),
});

const BitbucketUserSchema = Schema.Struct({
  username: Schema.optional(TrimmedNonEmptyString),
  display_name: Schema.optional(TrimmedNonEmptyString),
  account_id: Schema.optional(TrimmedNonEmptyString),
});

export interface BitbucketRepositoryLocator {
  readonly workspace: string;
  readonly repoSlug: string;
}

export class BitbucketApi extends Context.Service<
  BitbucketApi,
  {
    readonly probeAuth: Effect.Effect<SourceControlProviderAuth, never>;
    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly repository: string;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, BitbucketApiError>;
    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, BitbucketApiError>;
  }
>()("@upcomputer/server/sourceControl/BitbucketApi") {}

function nonEmpty(value: string | undefined): Option.Option<string> {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? Option.none() : Option.some(trimmed);
}

function parseBitbucketRepositorySlug(value: string): BitbucketRepositoryLocator | null {
  const normalized = value.trim().replace(/\.git$/u, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  const workspace = parts.at(-2);
  const repoSlug = parts.at(-1);
  return workspace && repoSlug ? { workspace, repoSlug } : null;
}

function requireRepositoryLocator(
  repository: string,
): Effect.Effect<BitbucketRepositoryLocator, BitbucketApiError> {
  const locator = parseBitbucketRepositorySlug(repository);
  return locator
    ? Effect.succeed(locator)
    : Effect.fail(
        new BitbucketRepositoryLocatorError({
          repository,
        }),
      );
}

function parseBitbucketRemoteUrl(remoteUrl: string): BitbucketRepositoryLocator | null {
  const trimmed = remoteUrl.trim();
  const scpMatch = /^[a-zA-Z0-9._-]+@[^:/]+:(.+)$/.exec(trimmed);
  if (scpMatch?.[1]) {
    return parseBitbucketRepositorySlug(scpMatch[1]);
  }

  try {
    return parseBitbucketRepositorySlug(new URL(trimmed).pathname);
  } catch {
    return null;
  }
}

function normalizeRepositoryCloneUrls(
  raw: typeof RawBitbucketRepositorySchema.Type,
): SourceControlRepositoryCloneUrls {
  const httpClone =
    raw.links.clone?.find((entry) => entry.name.toLowerCase() === "https")?.href ??
    raw.links.html?.href;
  const sshClone = raw.links.clone?.find((entry) => entry.name.toLowerCase() === "ssh")?.href;

  return {
    nameWithOwner: raw.full_name,
    url: httpClone ?? raw.links.html?.href ?? raw.full_name,
    sshUrl: sshClone ?? httpClone ?? raw.full_name,
  };
}

function authFromConfig(
  config: Config.Success<typeof BitbucketApiEnvConfig>,
): SourceControlProviderAuth {
  if (Option.isSome(config.accessToken)) {
    return {
      status: "unknown",
      account: Option.none(),
      host: Option.some("bitbucket.org"),
      detail: Option.some("Bitbucket access token is configured."),
    };
  }

  if (Option.isSome(config.email) && Option.isSome(config.apiToken)) {
    return {
      status: "unknown",
      account: config.email,
      host: Option.some("bitbucket.org"),
      detail: Option.some("Bitbucket API token is configured."),
    };
  }

  return {
    status: "unauthenticated",
    account: Option.none(),
    host: Option.some("bitbucket.org"),
    detail: Option.some(
      "Set UPCOMPUTER_BITBUCKET_EMAIL and UPCOMPUTER_BITBUCKET_API_TOKEN, or UPCOMPUTER_BITBUCKET_ACCESS_TOKEN.",
    ),
  };
}

function responseError(
  operation: BitbucketApiOperation,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, BitbucketApiError> {
  return response.text.pipe(
    Effect.mapError(
      (cause) =>
        new BitbucketResponseBodyReadError({
          operation,
          status: response.status,
          cause,
        }),
    ),
    Effect.flatMap((body) =>
      Effect.fail(
        new BitbucketResponseError({
          operation,
          status: response.status,
          responseBodyLength: body.length,
        }),
      ),
    ),
  );
}

export const make = Effect.gen(function* () {
  const config = yield* BitbucketApiEnvConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;

  const apiUrl = (path: string) => `${config.baseUrl.replace(/\/+$/u, "")}${path}`;

  const withAuth = (request: HttpClientRequest.HttpClientRequest) => {
    if (Option.isSome(config.accessToken)) {
      return request.pipe(HttpClientRequest.bearerToken(config.accessToken.value));
    }
    if (Option.isSome(config.email) && Option.isSome(config.apiToken)) {
      return request.pipe(HttpClientRequest.basicAuth(config.email.value, config.apiToken.value));
    }
    return request;
  };

  const decodeResponse = <S extends Schema.Top>(
    operation: BitbucketApiOperation,
    schema: S,
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<S["Type"], BitbucketApiError, S["DecodingServices"]> =>
    HttpClientResponse.matchStatus({
      "2xx": (success) =>
        HttpClientResponse.schemaBodyJson(schema)(success).pipe(
          Effect.mapError(
            (cause) =>
              new BitbucketResponseDecodeError({
                operation,
                status: success.status,
                cause,
              }),
          ),
        ),
      orElse: (failed) => responseError(operation, failed),
    })(response);

  const executeJson = <S extends Schema.Top>(
    operation: BitbucketApiOperation,
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
  ): Effect.Effect<S["Type"], BitbucketApiError, S["DecodingServices"]> =>
    httpClient.execute(withAuth(request.pipe(HttpClientRequest.acceptJson))).pipe(
      Effect.mapError(
        (cause) =>
          new BitbucketRequestError({
            operation,
            cause,
          }),
      ),
      Effect.flatMap((response) => decodeResponse(operation, schema, response)),
    );

  const resolveRepository = Effect.fn("BitbucketApi.resolveRepository")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository?: string;
  }) {
    const fromRepository =
      input.repository !== undefined ? parseBitbucketRepositorySlug(input.repository) : null;
    if (fromRepository) return fromRepository;

    const fromContext =
      input.context?.provider.kind === "bitbucket"
        ? parseBitbucketRemoteUrl(input.context.remoteUrl)
        : null;
    if (fromContext) return fromContext;

    const handle = yield* vcsRegistry.resolve({ cwd: input.cwd }).pipe(
      Effect.mapError(
        (cause) =>
          new BitbucketRepositoryVcsResolveError({
            cwd: input.cwd,
            cause,
          }),
      ),
    );
    const remotes = yield* handle.driver.listRemotes(input.cwd).pipe(
      Effect.mapError(
        (cause) =>
          new BitbucketRepositoryRemotesListError({
            cwd: input.cwd,
            cause,
          }),
      ),
    );

    for (const remote of remotes.remotes) {
      if (detectSourceControlProviderFromRemoteUrl(remote.url)?.kind !== "bitbucket") continue;
      const parsed = parseBitbucketRemoteUrl(remote.url);
      if (parsed) return parsed;
    }

    return yield* new BitbucketRepositoryRemoteNotFoundError({
      cwd: input.cwd,
    });
  });

  const getRepositoryFromLocator = (repository: BitbucketRepositoryLocator) =>
    executeJson(
      "getRepository",
      HttpClientRequest.get(
        apiUrl(
          `/repositories/${encodeURIComponent(repository.workspace)}/${encodeURIComponent(repository.repoSlug)}`,
        ),
      ),
      RawBitbucketRepositorySchema,
    );

  const getRepository = (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository?: string;
  }) => resolveRepository(input).pipe(Effect.flatMap(getRepositoryFromLocator));

  return BitbucketApi.of({
    probeAuth: executeJson(
      "probeAuth",
      HttpClientRequest.get(apiUrl("/user")),
      BitbucketUserSchema,
    ).pipe(
      Effect.map((user) => ({
        status: "authenticated" as const,
        account: nonEmpty(user.username ?? user.display_name ?? user.account_id),
        host: Option.some("bitbucket.org"),
        detail: Option.none<string>(),
      })),
      Effect.orElseSucceed(() => authFromConfig(config)),
    ),
    getRepositoryCloneUrls: (input) =>
      getRepository(input).pipe(Effect.map(normalizeRepositoryCloneUrls)),
    createRepository: (input) =>
      requireRepositoryLocator(input.repository).pipe(
        Effect.flatMap((repository) =>
          executeJson(
            "createRepository",
            HttpClientRequest.post(
              apiUrl(
                `/repositories/${encodeURIComponent(repository.workspace)}/${encodeURIComponent(repository.repoSlug)}`,
              ),
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                scm: "git",
                is_private: input.visibility === "private",
              }),
            ),
            RawBitbucketRepositorySchema,
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
  });
});

export const layer = Layer.effect(BitbucketApi, make);
