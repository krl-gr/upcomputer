import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { UPCOMPUTER_PRODUCT_FLAGS, UPSTREAM_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ServerProduct, composeExperimentalServerFeatures } from "../product/ServerProduct.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestReviewGuideService from "../pullRequest/PullRequestReviewGuideService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as McpToolAccessTestkit from "./McpToolAccess.testkit.ts";

const token = "session-token";
const scope: McpInvocationContext.McpThreadInvocationScope = {
  environmentId: EnvironmentId.make("environment-local"),
  requestNamespace: token,
  thread: {
    threadId: ThreadId.make("thread-1"),
    providerSessionId: token,
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["pull-requests"]),
  issuedAt: 1,
};

const listToolsAsAgent = Effect.gen(function* () {
  const serverLayer = McpHttpServer.layerMcpTransport(McpHttpServer.layerPullRequestsToolkit).pipe(
    Layer.provide(ServerSettings.layerTest()),
    Layer.provide(
      Layer.mock(McpSessionRegistry.McpSessionRegistry)({
        resolve: (value) => Effect.succeed(value === token ? scope : undefined),
      }),
    ),
    Layer.provide(
      Layer.mergeAll(
        McpToolAccessTestkit.liveThreadsLayer,
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(PullRequestReviewGuideService.PullRequestReviewGuideService)({}),
        Layer.mock(Orchestrator.OrchestratorV2)({}),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
        NodeServices.layer,
        NodeCrypto.layer,
      ),
    ),
  );
  yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.build,
  );
  const httpClient = yield* HttpClient.HttpClient;
  const headers = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  const initialize = yield* httpClient.post("/mcp", {
    headers,
    body: HttpBody.text(
      `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}`,
      "application/json",
    ),
  });
  const listed = yield* httpClient.post("/mcp", {
    headers: {
      ...headers,
      "mcp-session-id": initialize.headers["mcp-session-id"]!,
      "mcp-protocol-version": "2025-06-18",
    },
    body: HttpBody.text(
      `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
      "application/json",
    ),
  });
  const body = (yield* listed.json) as {
    readonly result: { readonly tools: ReadonlyArray<{ readonly name: string }> };
  };
  return body.result.tools.map((tool) => tool.name);
}).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest));

it.effect("gives agents the PR link and watch tools while the PR screens stay hidden", () =>
  Effect.gen(function* () {
    // The CLI provides the product to the whole program, request fibers included.
    const upComputer = yield* listToolsAsAgent.pipe(
      Effect.provideService(
        ServerProduct,
        composeExperimentalServerFeatures([], { flags: UPCOMPUTER_PRODUCT_FLAGS }),
      ),
    );
    expect(upComputer).toEqual(
      expect.arrayContaining([
        "link_pull_request",
        "link_pull_requests",
        "unlink_pull_request",
        "list_thread_pull_requests",
        "watch_pull_request",
        "unwatch_pull_request",
      ]),
    );
    // Review guides are the PR Guide tab's, which Up.computer hides.
    expect(upComputer).not.toContain("write_pull_request_guides");
    expect(upComputer).not.toContain("read_pull_request_guide");

    const upstream = yield* listToolsAsAgent.pipe(
      Effect.provideService(
        ServerProduct,
        composeExperimentalServerFeatures([], { flags: UPSTREAM_PRODUCT_FLAGS }),
      ),
    );
    expect(upstream).toEqual(
      expect.arrayContaining(["write_pull_request_guides", "read_pull_request_guide"]),
    );
  }),
);
