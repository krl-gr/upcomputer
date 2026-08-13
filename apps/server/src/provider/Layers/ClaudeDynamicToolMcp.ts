import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type {
  ExperimentalDynamicToolInvocationContext,
  ExperimentalDynamicToolLease,
  ExperimentalDynamicToolSpec,
} from "../../product/DynamicToolRegistry.ts";

const DEFAULT_SERVER_NAME = "upcomputer_dynamic";
const MAX_TOOL_RESULT_CHARS = 32_000;

export interface ClaudeDynamicToolMcpOptions {
  readonly lease: ExperimentalDynamicToolLease<never, never>;
  readonly invocationContext: () => ExperimentalDynamicToolInvocationContext | undefined;
  readonly onExecutionFailure?: (input: {
    readonly namespace: string | undefined;
    readonly toolName: string;
    readonly cause: unknown;
  }) => void;
}

function boundedText(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[Result truncated by UpComputer]`;
}

function errorResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text: boundedText(text) }],
    isError: true,
  };
}

function serverNameForSpec(spec: ExperimentalDynamicToolSpec): string {
  return spec.namespace ?? DEFAULT_SERVER_NAME;
}

/**
 * Builds app-owned, in-process MCP servers from one immutable registry lease.
 *
 * Claude Agent SDK 0.3.170 / Claude Code 2.1.170 exposes custom tools through
 * SDK MCP servers, not through a provider-native JSON-schema tool option. The
 * low-level MCP handlers are intentional: unlike `tool()`, they accept the
 * registry's JSON Schemas verbatim instead of translating or duplicating them.
 * A running Claude session keeps this lease; registry changes require a new
 * provider session (a resumed session is re-created and receives a fresh lease).
 */
export function makeClaudeDynamicToolMcpServers(
  options: ClaudeDynamicToolMcpOptions,
): Readonly<Record<string, McpSdkServerConfigWithInstance>> {
  const grouped = new Map<string, Array<ExperimentalDynamicToolSpec>>();
  const serverNamespaces = new Map<string, string | undefined>();
  const jsonSchemaValidator = new AjvJsonSchemaValidator();
  for (const spec of options.lease.specs) {
    const serverName = serverNameForSpec(spec);
    if (serverNamespaces.has(serverName) && serverNamespaces.get(serverName) !== spec.namespace) {
      throw new Error(
        `Dynamic-tool namespace '${serverName}' collides with Claude's unnamespaced tool server.`,
      );
    }
    serverNamespaces.set(serverName, spec.namespace);
    const specs = grouped.get(serverName);
    if (specs) specs.push(spec);
    else grouped.set(serverName, [spec]);
  }

  return Object.fromEntries(
    [...grouped].map(([serverName, specs]) => {
      const admitted = new Map(specs.map((spec) => [spec.name, spec] as const));
      const validators = new Map(
        specs.map(
          (spec) =>
            [
              spec.name,
              jsonSchemaValidator.getValidator<Record<string, unknown>>(spec.inputSchema as never),
            ] as const,
        ),
      );
      // Passing an array advertises the tools capability. We install low-level
      // handlers below so the canonical JSON schemas remain byte-for-byte data.
      const config = createSdkMcpServer({
        name: serverName,
        version: "1",
        tools: [],
        alwaysLoad: true,
      });

      config.instance.server.setRequestHandler(ListToolsRequestSchema, () =>
        Promise.resolve({
          tools: specs.map((spec) => ({
            name: spec.name,
            description: spec.description,
            inputSchema: spec.inputSchema as { type: "object"; [key: string]: unknown },
            _meta: { "anthropic/alwaysLoad": true },
          })),
        }),
      );

      config.instance.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;
        const spec = admitted.get(toolName);
        if (!spec) return errorResult(`Unknown or unadmitted dynamic tool: ${toolName}.`);

        const args = request.params.arguments;
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
          return errorResult(`Dynamic tool '${toolName}' requires an object input.`);
        }
        const validation = validators.get(toolName)?.(args);
        if (!validation?.valid) {
          return errorResult(
            `Invalid input for dynamic tool '${toolName}': ${validation?.errorMessage ?? "schema validation failed"}`,
          );
        }

        const context = options.invocationContext();
        if (!context) {
          return errorResult(`Dynamic tool '${toolName}' is unavailable outside an active turn.`);
        }

        const result = await Effect.runPromise(
          Effect.exit(options.lease.execute(toolName, args, context)),
        );
        if (Exit.isFailure(result)) {
          options.onExecutionFailure?.({
            namespace: spec.namespace,
            toolName,
            cause: result.cause,
          });
          return errorResult(`Dynamic tool '${toolName}' failed.`);
        }

        return {
          content: [{ type: "text" as const, text: boundedText(result.value.text) }],
          isError: result.value.isError,
        } satisfies CallToolResult;
      });

      return [serverName, config] as const;
    }),
  );
}
