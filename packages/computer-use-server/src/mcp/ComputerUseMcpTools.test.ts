// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import type { ServerConfig } from "../../../../apps/server/src/config.ts";
import {
  McpInvocationContext,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { ComputerUseService, createComputerUseService } from "../computerUse/ComputerUseService.ts";
import { COMPUTER_USE_TOOL_NAMES } from "../computerUse/ComputerUseToolDefinitions.ts";
import { computerUseSettingsPath } from "../settings/ComputerUseSettingsFile.ts";
import { ComputerUseMcpToolsLive } from "./ComputerUseMcpTools.ts";

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

const threadId = ThreadId.make("thread-1");
const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "any-provider", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "any-provider", version: "1" },
  },
  getClient: Effect.die("unused"),
});

function textOf(result: McpSchema.CallToolResult): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function makeFixture() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "computer-use-mcp-"));
  const settingsPath = NodePath.join(directory, "settings.json");
  const callsPath = NodePath.join(directory, "calls.log");
  NodeFS.writeFileSync(callsPath, "");
  const backend = {
    binaryPath: process.execPath,
    mcpArgs: [writeFixtureBackend(directory, callsPath)],
  };
  const writeSettings = (computerUse: Record<string, unknown>) =>
    NodeFS.writeFileSync(
      computerUseSettingsPath(settingsPath),
      JSON.stringify({ computerUse: { ...backend, ...computerUse } }),
    );
  const thread: { interactionMode: ProviderInteractionMode; runtimeMode: RuntimeMode } = {
    interactionMode: "plan",
    runtimeMode: "full-access",
  };
  const computerUse = createComputerUseService(
    { stateDir: directory, settingsPath } as ServerConfig["Service"],
    { childProcessSpawner: {} as never },
  );
  const threads = Layer.mock(ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(id === threadId ? ({ id, ...thread } as OrchestrationV2ThreadShell) : null),
  });
  const layer = ComputerUseMcpToolsLive.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(threads),
    Layer.provide(Layer.succeed(ComputerUseService, computerUse)),
  );
  const cleanup = Effect.promise(async () => {
    await computerUse.stop();
    NodeFS.rmSync(directory, { recursive: true, force: true });
  });
  return {
    layer,
    thread,
    writeSettings,
    settingsPath,
    cleanup,
    backendCalls: () => NodeFS.readFileSync(callsPath, "utf8").split("\n").filter(Boolean),
  };
}

const callAs = (calledThreadId: ThreadId) =>
  Effect.fn("test.callTool")(function* (name: string, args: Record<string, unknown> = {}) {
    const server = yield* McpServer.McpServer;
    return yield* server.callTool({ name, arguments: args }).pipe(
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: calledThreadId,
        providerSessionId: "session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set<never>(),
        issuedAt: 0,
      }),
      Effect.provideService(McpSchema.McpServerClient, mcpClient),
    );
  });

it.live("every provider session gets the computer-use tools under its thread's modes", () => {
  const fixture = makeFixture();
  fixture.writeSettings({});
  const call = callAs(threadId);
  return Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const listed = new Map(server.tools.map(({ tool }) => [tool.name, tool]));
    assert.deepStrictEqual([...listed.keys()].toSorted(), [...COMPUTER_USE_TOOL_NAMES].toSorted());
    assert.strictEqual(listed.get("computer_click")?.annotations?.readOnlyHint, false);
    assert.strictEqual(listed.get("computer_list_apps")?.annotations?.readOnlyHint, true);

    // Plan only observes: reading works, acting is refused before the backend.
    const observed = yield* call("computer_get_app_state", { app: "Notes" });
    assert.isFalse(observed.isError);
    assert.strictEqual(textOf(observed), "get_app_state ok");
    const refused = yield* call("computer_click", { app: "Notes", elementIndex: 1 });
    assert.isTrue(refused.isError);
    assert.match(textOf(refused), /unavailable in Plan mode/u);
    assert.deepStrictEqual(fixture.backendCalls(), ["get_app_state"]);

    // Default may act, and actions need no approval by default. The mode is read on every call.
    fixture.thread.interactionMode = "default";
    const clicked = yield* call("computer_click", { app: "Notes", elementIndex: 1 });
    assert.isFalse(clicked.isError);
    assert.deepStrictEqual(fixture.backendCalls(), ["get_app_state", "click"]);

    // Credential and payment apps stay blocked in every mode.
    const sensitive = yield* call("computer_get_app_state", { app: "1Password" });
    assert.isTrue(sensitive.isError);
    assert.match(textOf(sensitive), /credential or payment surface/u);
    const keychain = yield* call("computer_click", { app: "Keychain Access", elementIndex: 1 });
    assert.isTrue(keychain.isError);

    // Where approval would be needed, these agents are refused.
    fixture.thread.runtimeMode = "approval-required";
    const supervised = yield* call("computer_list_apps");
    assert.isTrue(supervised.isError);
    assert.match(textOf(supervised), /Supervised/u);
    fixture.thread.runtimeMode = "full-access";
    fixture.writeSettings({ requireActionApproval: true });
    const unapproved = yield* call("computer_click", { app: "Notes", elementIndex: 1 });
    assert.isTrue(unapproved.isError);
    assert.match(textOf(unapproved), /Action approvals/u);

    // Observe mode in Settings rules out actions for every thread.
    fixture.writeSettings({ mode: "observe" });
    const observeOnly = yield* call("computer_click", { app: "Notes", elementIndex: 1 });
    assert.isTrue(observeOnly.isError);
    assert.match(textOf(observeOnly), /control mode is disabled/u);
    assert.deepStrictEqual(fixture.backendCalls(), ["get_app_state", "click"]);
  }).pipe(Effect.provide(fixture.layer), Effect.ensuring(fixture.cleanup));
});

it.live("a session whose thread cannot be resolved is refused every tool", () => {
  const fixture = makeFixture();
  fixture.writeSettings({});
  return Effect.gen(function* () {
    const result = yield* callAs(ThreadId.make("thread-unknown"))("computer_list_apps");
    assert.isTrue(result.isError);
    assert.match(textOf(result), /could not be resolved/u);
    assert.deepStrictEqual(fixture.backendCalls(), []);
  }).pipe(Effect.provide(fixture.layer), Effect.ensuring(fixture.cleanup));
});

it.live("settings carried over from a V1 settings.json apply until saved here", () => {
  const fixture = makeFixture();
  fixture.thread.interactionMode = "default";
  return Effect.gen(function* () {
    NodeFS.writeFileSync(fixture.settingsPath, JSON.stringify({ computerUse: { enabled: false } }));
    const disabled = yield* callAs(threadId)("computer_list_apps");
    assert.isTrue(disabled.isError);
    assert.match(textOf(disabled), /disabled in Settings/u);

    fixture.writeSettings({ enabled: true });
    const enabled = yield* callAs(threadId)("computer_list_apps");
    assert.isFalse(enabled.isError);
  }).pipe(Effect.provide(fixture.layer), Effect.ensuring(fixture.cleanup));
});
