import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as BitbucketApi from "./BitbucketApi.ts";
import * as BitbucketSourceControlProvider from "./BitbucketSourceControlProvider.ts";

function makeProvider(bitbucket: Partial<BitbucketApi.BitbucketApi["Service"]>) {
  return BitbucketSourceControlProvider.make.pipe(
    Effect.provide(Layer.mock(BitbucketApi.BitbucketApi)(bitbucket)),
  );
}

it.effect("adds repository context while retaining Bitbucket API causes", () =>
  Effect.gen(function* () {
    const upstreamCause = new Error("raw upstream failure");
    const cause = new BitbucketApi.BitbucketRequestError({
      operation: "getRepository",
      cause: upstreamCause,
    });
    const provider = yield* makeProvider({
      getRepositoryCloneUrls: () => Effect.fail(cause),
    });

    const error = yield* provider
      .getRepositoryCloneUrls({ cwd: "/repo", repository: "owner/repo" })
      .pipe(Effect.flip);

    assert.deepStrictEqual(
      {
        provider: error.provider,
        operation: error.operation,
        command: error.command,
        cwd: error.cwd,
        repository: error.repository,
        detail: error.detail,
      },
      {
        provider: "bitbucket",
        operation: "getRepositoryCloneUrls",
        command: undefined,
        cwd: "/repo",
        repository: "owner/repo",
        detail: "Failed to get repository clone URLs.",
      },
    );
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message.includes(upstreamCause.message), false);
  }),
);
