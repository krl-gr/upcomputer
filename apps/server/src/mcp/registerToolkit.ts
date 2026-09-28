import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer, Tool, type Toolkit } from "effect/unstable/ai";

/**
 * Failures agents may read verbatim: tool errors written for agents, and
 * toolkit errors describing invalid tool-call parameters. Anything else,
 * including defects, is logged and reported without detail so stack traces
 * and internal state never reach the provider.
 */
const EXPOSED_FAILURE_TAGS: ReadonlySet<string> = new Set(["McpWorkspaceToolError", "AiError"]);

const readableFailure = (
  error: unknown,
): { readonly _tag: string; readonly code?: string; readonly message: string } | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as {
    readonly _tag?: unknown;
    readonly code?: unknown;
    readonly message?: unknown;
  };
  if (typeof record._tag !== "string" || !EXPOSED_FAILURE_TAGS.has(record._tag)) return undefined;
  if (typeof record.message !== "string") return undefined;
  return {
    _tag: record._tag,
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    message: record.message,
  };
};

export const toolFailureResult = <E>(toolName: string, cause: Cause.Cause<E>) => {
  if (Cause.hasInterrupts(cause)) return Effect.failCause(cause).pipe(Effect.orDie);
  const failure = cause.reasons.find(Cause.isFailReason);
  const readable = failure === undefined ? undefined : readableFailure(failure.error);
  if (readable !== undefined) {
    return Effect.succeed(
      new McpSchema.CallToolResult({
        isError: true,
        structuredContent: { error: readable },
        content: [{ type: "text", text: readable.message }],
      }),
    );
  }
  return Effect.logWarning("MCP tool failed unexpectedly", { toolName, cause }).pipe(
    Effect.as(
      new McpSchema.CallToolResult({
        isError: true,
        structuredContent: { error: { _tag: "InternalError", message: "Internal error." } },
        content: [{ type: "text", text: `${toolName} failed with an internal error.` }],
      }),
    ),
  );
};

/** A tool's declared failure or an `AiError` from the toolkit itself. */
interface ToolkitCallError {
  readonly _tag: string;
}

/**
 * Like `McpServer.toolkit`, but failures become bounded `isError` results
 * (see `toolFailureResult`) instead of a pretty-printed cause.
 */
export const registerToolkit = Effect.fnUntraced(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
) {
  const server = yield* McpServer.McpServer;
  const built = yield* toolkit as unknown as Effect.Effect<Toolkit.WithHandler<Tools>>;
  const services = yield* Effect.context<never>();
  for (const tool of Object.values(built.tools)) {
    yield* server.addTool({
      tool: new McpSchema.Tool({
        name: tool.name,
        description: Tool.getDescription(tool),
        inputSchema: Tool.getJsonSchema(tool),
        annotations: {
          ...Context.getOption(tool.annotations, Tool.Title).pipe(
            Option.map((title) => ({ title })),
            Option.getOrUndefined,
          ),
          readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
          destructiveHint: Context.get(tool.annotations, Tool.Destructive),
          idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
          openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
        },
      }),
      annotations: tool.annotations,
      handle: (payload) =>
        (
          built.handle(tool.name as never, payload as never) as unknown as Effect.Effect<
            Stream.Stream<Tool.HandlerResult<Tool.Any>, ToolkitCallError>,
            ToolkitCallError
          >
        ).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideContext(services),
          Effect.matchCauseEffect({
            onFailure: (cause) => toolFailureResult(tool.name, cause),
            onSuccess: (result) =>
              Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent:
                    typeof result.encodedResult === "object" && result.encodedResult !== null
                      ? (result.encodedResult as Record<string, unknown>)
                      : undefined,
                  content: [{ type: "text", text: JSON.stringify(result.encodedResult) }],
                }),
              ),
          }),
        ),
    });
  }
});
