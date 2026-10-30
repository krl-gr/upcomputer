// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { onTestFinished, test } from "vite-plus/test";

import type { ServerConfig } from "../../../../apps/server/src/config.ts";
import { computerUseSettingsPath } from "../settings/ComputerUseSettingsFile.ts";
import { createComputerUseService } from "./ComputerUseService.ts";
import { COMPUTER_USE_TOOLS } from "./ComputerUseToolDefinitions.ts";

const ALL_BACKEND_TOOLS = [...new Set(COMPUTER_USE_TOOLS.map((tool) => tool.backendName))];

// A stand-in for the sidecar that offers the given tools and never touches the desktop.
function makeService(backendTools: ReadonlyArray<string>) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "computer-use-service-"));
  const serverModule = import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  const stdioModule = import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js");
  const backendPath = NodePath.join(directory, "backend.mjs");
  NodeFS.writeFileSync(
    backendPath,
    `import { McpServer } from ${JSON.stringify(serverModule)};
import { StdioServerTransport } from ${JSON.stringify(stdioModule)};
const server = new McpServer({ name: "fixture", version: "0.0.0" });
for (const name of ${JSON.stringify(backendTools)}) {
  server.tool(name, async () => ({ content: [{ type: "text", text: name + " ok" }] }));
}
await server.connect(new StdioServerTransport());
`,
  );
  const settingsPath = NodePath.join(directory, "settings.json");
  NodeFS.writeFileSync(
    computerUseSettingsPath(settingsPath),
    JSON.stringify({
      computerUse: { enabled: true, binaryPath: process.execPath, mcpArgs: [backendPath] },
    }),
  );
  const service = createComputerUseService(
    { stateDir: directory, settingsPath } as ServerConfig["Service"],
    { childProcessSpawner: {} as never, stopAppAgent: async () => undefined },
  );
  onTestFinished(async () => {
    await service.stop();
    NodeFS.rmSync(directory, { recursive: true, force: true });
  });
  return service;
}

test("a tool call that starts the backend records its tools for the snapshot", async () => {
  const service = makeService(ALL_BACKEND_TOOLS);

  const result = await service.callTool({ toolName: "computer_list_apps", args: {} });
  const snapshot = await service.snapshot();

  NodeAssert.equal(result.isError, false);
  NodeAssert.equal(snapshot.status, "ready");
  NodeAssert.deepEqual(snapshot.missingRequiredTools, []);
});

test("a backend started by a tool call that lacks required tools still reports them", async () => {
  const service = makeService(["list_apps", "get_app_state"]);

  const result = await service.callTool({ toolName: "computer_list_apps", args: {} });
  const snapshot = await service.snapshot();

  NodeAssert.equal(result.isError, false);
  NodeAssert.equal(snapshot.status, "ready");
  NodeAssert.ok(snapshot.missingRequiredTools.includes("click"));
  NodeAssert.ok(!snapshot.missingRequiredTools.includes("list_apps"));
  NodeAssert.ok(!snapshot.missingRequiredTools.includes("get_app_state"));
});
