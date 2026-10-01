import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import { test } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { normalizeComputerUseBackendArgs } from "./ComputerUseBackendArgs.ts";
import {
  computerUseSidecarExecutableRelativePath,
  COMPUTER_USE_SIDECAR_VERSION,
} from "./ManagedComputerUseSidecar.ts";

// Reads tools/list only; never clicks/types or requires an authenticated provider.
// Opt in on a desktop/native runner: UPCOMPUTER_TEST_NATIVE_COMPUTER_USE=1 vp test run ...
test.skipIf(process.env.UPCOMPUTER_TEST_NATIVE_COMPUTER_USE !== "1")(
  "adapter arguments match the actual bundled native MCP schemas",
  async () => {
    const require = NodeModule.createRequire(import.meta.url);
    const manifest = require("open-computer-use/package.json");
    NodeAssert.equal(manifest.version, COMPUTER_USE_SIDECAR_VERSION);
    const command = NodePath.join(
      NodePath.dirname(require.resolve("open-computer-use/package.json")),
      // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Checks the binary for this host.
      computerUseSidecarExecutableRelativePath({ platform: process.platform, arch: process.arch }),
    );
    const client = new Client({ name: "upcomputer-contract-test", version: "1" });
    const transport = new StdioClientTransport({ command, args: ["mcp"] });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const app = "contract-test-only-not-executed";
      const examples: Array<[string, Record<string, unknown>]> = [
        ["list_apps", {}],
        ["get_app_state", { app }],
        ["click", { app, elementIndex: 1, button: "right", double: true }],
        ["click", { app, x: 10, y: 20 }],
        ["click", { app, x: 10, y: 20, coordinateMethod: "sky_click" }],
        ["type_text", { app, text: "test" }],
        ["press_key", { app, key: "Enter", modifiers: ["cmd"] }],
        ["scroll", { app, elementIndex: 1, direction: "down", amount: 0.5 }],
        ["perform_secondary_action", { app, elementIndex: 1, action: "Raise" }],
        ["set_value", { app, elementIndex: 1, value: "test" }],
        ["drag", { app, fromX: 1, fromY: 2, toX: 3, toY: 4 }],
      ];
      for (const [name, args] of examples) {
        const tool = tools.find((tool) => tool.name === name);
        NodeAssert.ok(tool, name);
        const normalized = normalizeComputerUseBackendArgs(name, args);
        for (const key of tool.inputSchema.required ?? [])
          NodeAssert.ok(key in normalized, `${name}: missing ${key}`);
        for (const [key, value] of Object.entries(normalized)) {
          const property = tool.inputSchema.properties?.[key] as
            | { type?: string; enum?: unknown[] }
            | undefined;
          NodeAssert.ok(property, `${name}: unsupported ${key}`);
          if (property.type === "integer") NodeAssert.ok(Number.isInteger(value));
          else if (property.type) NodeAssert.equal(typeof value, property.type, `${name}.${key}`);
          if (property.enum)
            NodeAssert.ok(property.enum.includes(value), `${name}.${key}: unsupported enum`);
        }
      }
    } finally {
      await client.close();
      await transport.close();
    }
  },
  30_000,
);
