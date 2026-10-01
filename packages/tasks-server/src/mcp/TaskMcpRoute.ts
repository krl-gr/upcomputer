import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { defineHttpRouteContribution } from "../../../../apps/server/src/extensionApi.ts";
import { TASK_TOOL_SPECS } from "../tools/TaskToolDefinitions.ts";
import { TaskToolService, type TaskToolServiceShape } from "../tools/TaskToolServiceTag.ts";

export const TASK_MCP_ROUTE_PATH = "/api/extensions/upcomputer.tasks/mcp" as const;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function address(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\](?::\d+)?$/, "$1");
  return (normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized).replace(
    /^(127(?:\.\d{1,3}){3}):\d+$/,
    "$1",
  );
}

function loopback(value: string): boolean {
  const normalized = address(value);
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function isLoopbackRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const remote = Option.getOrUndefined(request.remoteAddress);
  return remote !== undefined && loopback(remote);
}

function createServer(taskTools: TaskToolServiceShape): Server {
  const server = new Server(
    { name: "upcomputer-tasks", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: "Upcomputer task and task-agent tools." },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TASK_TOOL_SPECS.map(
      (spec): Tool => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema as Tool["inputSchema"],
      }),
    ),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await Effect.runPromise(
      taskTools.call({
        name: request.params.name,
        args: object(request.params.arguments) ? request.params.arguments : {},
        // This local bridge reaches here only after loopback validation.
        context: { source: "mcp", mutationPolicy: "allow" },
      }),
    );
    return { isError: result.isError, content: [{ type: "text", text: result.text }] };
  });
  return server;
}

function withMcpHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json, text/event-stream");
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    duplex: "half",
  };
  return new Request(request.url, init);
}

function errorResponse(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handle(webRequest: Request, taskTools: TaskToolServiceShape): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = createServer(taskTools);
  try {
    await server.connect(transport);
    return await transport.handleRequest(withMcpHeaders(webRequest));
  } finally {
    await server.close().catch(() => undefined);
  }
}

export const TASK_MCP_HTTP_CONTRIBUTION = defineHttpRouteContribution({
  id: "tasks-mcp-v1",
  ownerId: "upcomputer.tasks",
  version: 1,
  method: "*",
  path: TASK_MCP_ROUTE_PATH,
  handler: Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!isLoopbackRequest(request)) return HttpServerResponse.text("Not Found", { status: 404 });
    if (request.method === "OPTIONS") return HttpServerResponse.empty({ status: 204 });
    if (request.method !== "POST") {
      return HttpServerResponse.fromWeb(errorResponse(405, -32000, "Method not allowed."));
    }
    const taskTools = yield* TaskToolService;
    const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!webRequest) return HttpServerResponse.text("Bad Request", { status: 400 });
    const response = yield* Effect.tryPromise({
      try: () => handle(webRequest, taskTools),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to handle private task MCP request", { cause }).pipe(
          Effect.as(errorResponse(500, -32603, "Internal server error")),
        ),
      ),
    );
    return HttpServerResponse.fromWeb(response);
  }),
});
