import { describe, expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { MCP_TOOL_EXPOSURE_HEADER } from "@t3tools/provider-core/server/mcpSession";
import { UPCOMPUTER_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as GitManager from "../git/GitManager.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ServerProduct, composeExperimentalServerFeatures } from "../product/ServerProduct.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as PullRequestReviewGuideService from "../pullRequest/PullRequestReviewGuideService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as McpToolAccessTestkit from "./McpToolAccess.testkit.ts";

/** Each token is one MCP credential; the registry issues a new one when a provider restarts. */
const credential = (
  token: string,
  threadId: string,
  subagent = false,
): McpInvocationContext.McpThreadInvocationScope => ({
  environmentId: EnvironmentId.make("environment-local"),
  requestNamespace: token,
  thread: {
    threadId: ThreadId.make(threadId),
    providerSessionId: token,
    providerInstanceId: ProviderInstanceId.make("opencode"),
    ...(subagent ? { subagent } : {}),
  },
  client: undefined,
  capabilities: new Set(["pull-requests"]),
  issuedAt: 1,
});

const credentials = new Map(
  [
    credential("before-restart", "thread-restarted"),
    credential("after-restart", "thread-restarted"),
    credential("other-thread", "thread-other"),
  ].map((scope) => [scope.requestNamespace, scope]),
);

const serverLayer = McpHttpServer.layerMcpTransport(
  Layer.mergeAll(McpHttpServer.layerPullRequestsToolkit, McpHttpServer.layerToolSearch),
).pipe(
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(
    Layer.mock(McpSessionRegistry.McpSessionRegistry)({
      resolve: (token) => Effect.succeed(credentials.get(token)),
    }),
  ),
  Layer.provide(
    Layer.mergeAll(
      McpToolAccessTestkit.liveThreadsLayer,
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(GitManager.GitManager)({}),
      Layer.mock(PullRequestReviewGuideService.PullRequestReviewGuideService)({}),
      Layer.mock(PullRequestService.PullRequestService)({}),
      Layer.mock(Orchestrator.OrchestratorV2)({}),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: () => Effect.succeed(null),
      }),
      NodeServices.layer,
      NodeCrypto.layer,
    ),
  ),
);

/** An OpenCode-like client: it asks for deferred listing. */
const connect = Effect.fn(function* (token: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const headers = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    [MCP_TOOL_EXPOSURE_HEADER]: "deferred",
  };
  const initialize = yield* httpClient.post("/mcp", {
    headers,
    body: HttpBody.text(
      `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"opencode","version":"1.0.0"}}}`,
      "application/json",
    ),
  });
  let id = 1;
  const request = (method: string, params: object) =>
    Effect.suspend(() => {
      id += 1;
      return httpClient
        .post("/mcp", {
          headers: {
            ...headers,
            "mcp-session-id": initialize.headers["mcp-session-id"]!,
            "mcp-protocol-version": "2025-06-18",
          },
          body: HttpBody.text(
            JSON.stringify({ jsonrpc: "2.0", id, method, params }),
            "application/json",
          ),
        })
        .pipe(
          Effect.flatMap((response) => response.text),
          // A call that announces a list change answers as an event stream.
          Effect.map((text) => {
            const messages = text.startsWith("data:")
              ? text
                  .split("\n")
                  .flatMap((line) => (line.startsWith("data:") ? [line.slice(5)] : []))
              : [text];
            return messages
              .map(
                (message) =>
                  JSON.parse(message) as { id?: number; result: Record<string, unknown> },
              )
              .find((message) => message.id === id)!;
          }),
        );
    });
  return {
    listed: request("tools/list", {}).pipe(
      Effect.map(({ result }) =>
        (result["tools"] as ReadonlyArray<{ readonly name: string }>).map((tool) => tool.name),
      ),
    ),
    search: (query: string) =>
      request("tools/call", { name: "tool_search", arguments: { query } }).pipe(
        Effect.map(({ result }) =>
          (
            result["structuredContent"] as { readonly tools: ReadonlyArray<{ name: string }> }
          ).tools.map((tool) => tool.name),
        ),
      ),
  };
});

const withServer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.build,
    );
    return yield* effect;
  }).pipe(
    Effect.scoped,
    Effect.provide(NodeHttpServer.layerTest),
    Effect.provideService(
      ServerProduct,
      composeExperimentalServerFeatures([], { flags: UPCOMPUTER_PRODUCT_FLAGS }),
    ),
  );

describe("deferred tool listing", () => {
  it.effect("keeps a thread's loaded tools when its provider restarts with a new credential", () =>
    withServer(
      Effect.gen(function* () {
        const before = yield* connect("before-restart");
        expect(yield* before.listed).not.toContain("link_pull_request");
        expect(yield* before.search("link_pull_request")).toContain("link_pull_request");
        expect(yield* before.listed).toContain("link_pull_request");

        const after = yield* connect("after-restart");
        expect(yield* after.listed).toContain("link_pull_request");
        // Another thread did not search, so it does not list the tool.
        expect(yield* (yield* connect("other-thread")).listed).not.toContain("link_pull_request");
      }),
    ),
  );
});
