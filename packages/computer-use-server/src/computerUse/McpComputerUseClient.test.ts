// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { onTestFinished, test } from "vite-plus/test";

import type { ComputerUseSettings } from "@upcomputer/computer-use-contracts/settings";
import { McpComputerUseClient } from "./McpComputerUseClient.ts";

// A stdio MCP server whose `crash` tool kills the process and whose `pid` tool
// reports which process answered.
function writeFixtureServer(directory: string): string {
  const serverModule = import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  const stdioModule = import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js");
  const file = NodePath.join(directory, "server.mjs");
  NodeFS.writeFileSync(
    file,
    `import { McpServer } from ${JSON.stringify(serverModule)};
import { StdioServerTransport } from ${JSON.stringify(stdioModule)};
const server = new McpServer({ name: "fixture", version: "0.0.0" });
server.tool("pid", async () => ({ content: [{ type: "text", text: String(process.pid) }] }));
server.tool("crash", async () => { process.exit(1); });
await server.connect(new StdioServerTransport());
`,
  );
  return file;
}

function textOf(result: { readonly content?: ReadonlyArray<unknown> }): string {
  const first = result.content?.[0] as { readonly text?: string } | undefined;
  return first?.text ?? "";
}

test("a crashed sidecar is started again on the next call, without retrying the failed one", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "computer-use-client-"));
  onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  const settings = {
    enabled: true,
    mode: "control",
    binaryPath: process.execPath,
    mcpArgs: [writeFixtureServer(directory)],
    requireActionApproval: true,
    allowCoordinateFallback: false,
    allowedApps: [],
  } satisfies ComputerUseSettings;
  const client = new McpComputerUseClient();
  onTestFinished(() => client.stop());

  const firstPid = textOf(await client.callTool({ settings, backendName: "pid", args: {} }));
  await NodeAssert.rejects(client.callTool({ settings, backendName: "crash", args: {} }));
  const secondPid = textOf(await client.callTool({ settings, backendName: "pid", args: {} }));

  NodeAssert.match(firstPid, /^\d+$/);
  NodeAssert.match(secondPid, /^\d+$/);
  NodeAssert.notEqual(secondPid, firstPid);
});
