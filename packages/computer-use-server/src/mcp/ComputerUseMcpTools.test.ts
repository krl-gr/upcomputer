// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  EnvironmentId,
  type OrchestrationThreadShell,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@upcomputer/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { onTestFinished, test } from "vite-plus/test";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import {
  composeExperimentalServerFeatures,
  ProjectionSnapshotQuery,
} from "../../../../apps/server/src/extensionApi.ts";
import * as McpHttpServer from "../../../../apps/server/src/mcp/McpHttpServer.ts";
import * as McpSessionRegistry from "../../../../apps/server/src/mcp/McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "../../../../apps/server/src/mcp/PreviewAutomationBroker.ts";
import { getComputerUseService } from "../computerUse/ComputerUseService.ts";
import { COMPUTER_USE_TOOL_NAMES } from "../computerUse/ComputerUseToolDefinitions.ts";
import { COMPUTER_USE_SERVER_FEATURE } from "../serverFeature.ts";
import { computerUseSessionDenial } from "./ComputerUseMcpTools.ts";

// A stand-in for the sidecar: it records each call and never touches the desktop.
function writeFixtureBackend(directory: string, callsPath: string): string {
  const serverModule = import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  const stdioModule = import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js");
  const file = NodePath.join(directory, "backend.mjs");
  NodeFS.writeFileSync(
    file,
    `import { appendFileSync } from "node:fs";
import { McpServer } from ${JSON.stringify(serverModule)};
import { StdioServerTransport } from ${JSON.stringify(stdioModule)};
const server = new McpServer({ name: "fixture", version: "0.0.0" });
const record = (name) => async () => {
  appendFileSync(${JSON.stringify(callsPath)}, name + "\\n");
  return { content: [{ type: "text", text: name + " ok" }] };
};
for (const name of ["list_apps", "get_app_state", "click"]) server.tool(name, record(name));
await server.connect(new StdioServerTransport());
`,
  );
  return file;
}

interface ThreadState {
  interactionMode: string;
  runtimeMode: RuntimeMode;
}

function textOf(result: unknown): string {
  const content = (result as { readonly content?: ReadonlyArray<{ readonly text?: string }> })
    .content;
  return content?.[0]?.text ?? "";
}

test("any agent's MCP session gets the computer-use tools under its thread's mode", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "computer-use-mcp-"));
  onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  const serverConfig = {
    stateDir: directory,
    settingsPath: NodePath.join(directory, "settings.json"),
  };
  // The service is cached per state directory; stop the backend it started.
  onTestFinished(async () => {
    await getComputerUseService(serverConfig as ServerConfig["Service"], {} as never).stop();
  });
  const callsPath = NodePath.join(directory, "calls.log");
  NodeFS.writeFileSync(callsPath, "");
  const { settingsPath } = serverConfig;
  NodeFS.writeFileSync(
    settingsPath,
    JSON.stringify({
      computerUse: {
        binaryPath: process.execPath,
        mcpArgs: [writeFixtureBackend(directory, callsPath)],
        requireActionApproval: false,
      },
    }),
  );
  const backendCalls = () => NodeFS.readFileSync(callsPath, "utf8").split("\n").filter(Boolean);

  const thread: ThreadState = { interactionMode: "plan", runtimeMode: "full-access" };
  const threadId = ThreadId.make("thread-1");
  const invocation = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId,
    providerSessionId: "codex-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(["preview", "workspace"] as const),
    issuedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
  const credentials = Layer.succeed(
    McpSessionRegistry.McpSessionRegistry,
    McpSessionRegistry.McpSessionRegistry.of({
      issue: () => Effect.die("Credentials are issued by the provider service."),
      resolve: (token) => Effect.succeed(token === "thread-token" ? invocation : undefined),
      revokeProviderSession: () => Effect.void,
      revokeThread: () => Effect.void,
      revokeAll: Effect.void,
    }),
  );
  const projection = Layer.succeed(ProjectionSnapshotQuery, {
    getThreadShellById: (id: ThreadId) =>
      Effect.succeed(
        id === threadId
          ? Option.some({ id, ...thread } as OrchestrationThreadShell)
          : Option.none(),
      ),
  } as unknown as ProjectionSnapshotQuery["Service"]);
  const composition = composeExperimentalServerFeatures([COMPUTER_USE_SERVER_FEATURE]);
  // The server's own MCP layer; the preview and workspace tools it also serves are not called here.
  const mcpServer = HttpRouter.serve(
    McpHttpServer.layerWithTools(composition.mcpTools, composition.interactionModeRegistry).pipe(
      Layer.provide(credentials),
    ) as Layer.Layer<
      never,
      never,
      | HttpRouter.HttpRouter
      | PreviewAutomationBroker.PreviewAutomationBroker
      | ProjectionSnapshotQuery
      | ServerConfig
      | NodeServices.NodeServices
    >,
    { disableListenLog: true, disableLogger: true },
  ).pipe(
    Layer.provide(
      Layer.effect(
        PreviewAutomationBroker.PreviewAutomationBroker,
        PreviewAutomationBroker.makeWithServerHosts([]),
      ),
    ),
    Layer.provide(projection),
    Layer.provide(Layer.succeed(ServerConfig, serverConfig as ServerConfig["Service"])),
    Layer.provide(NodeServices.layer),
    Layer.provideMerge(NodeHttpServer.layer(NodeHttp.createServer, { port: 0, host: "127.0.0.1" })),
  );

  // oxlint-disable-next-line upcomputer/no-manual-effect-runtime-in-tests -- Drives the server with the Promise-based MCP SDK client.
  await Effect.runPromise(
    Effect.gen(function* () {
      const services = yield* Layer.build(mcpServer);
      const address = Context.get(services, HttpServer.HttpServer).address;
      NodeAssert.equal(address._tag, "TcpAddress");
      const endpoint = `http://127.0.0.1:${address._tag === "TcpAddress" ? address.port : 0}/mcp`;
      yield* Effect.promise(async () => {
        const client = new Client({ name: "any-harness", version: "0.0.0" });
        const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: { Authorization: "Bearer thread-token" } },
        });
        await client.connect(transport as Transport);
        try {
          const call = (name: string, args: Record<string, unknown> = {}) =>
            client.callTool({ name, arguments: args });
          const { tools } = await client.listTools();
          const listed = new Set(tools.map((tool) => tool.name));
          for (const name of COMPUTER_USE_TOOL_NAMES) NodeAssert.ok(listed.has(name), name);
          NodeAssert.equal(
            tools.find((tool) => tool.name === "computer_click")?.annotations?.readOnlyHint,
            false,
          );

          // Plan mode is read-only: observing works, acting is refused before the backend.
          const observed = await call("computer_get_app_state", { app: "Notes" });
          NodeAssert.equal(observed.isError, false);
          NodeAssert.equal(textOf(observed), "get_app_state ok");
          const refused = await call("computer_click", { app: "Notes", elementIndex: 1 });
          NodeAssert.equal(refused.isError, true);
          NodeAssert.match(textOf(refused), /unavailable in Plan mode/u);
          NodeAssert.deepEqual(backendCalls(), ["get_app_state"]);

          // The same session in the default mode may act; the mode is read on every call.
          thread.interactionMode = "default";
          const clicked = await call("computer_click", { app: "Notes", elementIndex: 1 });
          NodeAssert.equal(clicked.isError, false);
          NodeAssert.deepEqual(backendCalls(), ["get_app_state", "click"]);

          // Sensitive apps stay blocked exactly as for the bundled agent.
          const sensitive = await call("computer_get_app_state", { app: "1Password" });
          NodeAssert.equal(sensitive.isError, true);
          NodeAssert.match(textOf(sensitive), /credential or payment surface/u);

          // Where the bundled agent would ask for approval, these agents are refused.
          thread.runtimeMode = "approval-required";
          const supervised = await call("computer_list_apps");
          NodeAssert.equal(supervised.isError, true);
          thread.runtimeMode = "full-access";
          NodeFS.writeFileSync(
            settingsPath,
            JSON.stringify({
              computerUse: {
                binaryPath: process.execPath,
                mcpArgs: JSON.parse(NodeFS.readFileSync(settingsPath, "utf8")).computerUse.mcpArgs,
                requireActionApproval: true,
              },
            }),
          );
          const unapproved = await call("computer_click", { app: "Notes", elementIndex: 1 });
          NodeAssert.equal(unapproved.isError, true);
          NodeAssert.match(textOf(unapproved), /Action approvals/u);
          NodeAssert.deepEqual(backendCalls(), ["get_app_state", "click"]);
        } finally {
          await transport.terminateSession().catch(() => undefined);
          await client.close();
        }
      });
    }).pipe(Effect.scoped),
  );
});

test("a session whose thread or mode cannot be resolved is refused", () => {
  const session = {
    threadId: ThreadId.make("thread-unknown"),
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    runtimeMode: undefined,
    interactionMode: undefined,
    mutationPolicy: "deny",
  } as const;
  NodeAssert.match(
    computerUseSessionDenial({ mode: "observe" }, session) ?? "",
    /could not be resolved/u,
  );
});
