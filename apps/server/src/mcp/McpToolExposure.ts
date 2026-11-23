import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { McpSchema } from "effect/ai";

export const TOOL_SEARCH = "tool_search";

/** What a deferring client lists before it searches. Pi's extension declares the same three. */
const DIRECT_TOOLS: ReadonlySet<string> = new Set([
  "orchestrator_capabilities",
  "delegate_task",
  "task_status",
  TOOL_SEARCH,
]);

const MAX_RESULTS = 10;
// A long session keeps the newest loaded tools only, so its listing stays under 128-tool API limits.
const MAX_LOADED = 60;
// Threads that ended are never reported here, so keep only the newest.
const MAX_THREADS = 256;

export interface ListedTool {
  readonly name: string;
  readonly description: string;
}

export interface SearchableTool extends ListedTool {
  readonly enabledWhen?: McpSchema.EnabledWhen["Service"] | undefined;
}

/** Whether the calling session may list and call a tool; runs in the `tool_search` call. */
export type ToolSearchFilter = (tool: string) => Effect.Effect<boolean>;

const searchFilters = new Set<ToolSearchFilter>();

/**
 * For a `McpServer.visibility` a feature adds: `tool_search` cannot see those, so the
 * feature registers the same check here for the lifetime of the calling scope.
 */
export const registerToolSearchFilter = (filter: ToolSearchFilter) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      searchFilters.add(filter);
    }),
    () =>
      Effect.sync(() => {
        searchFilters.delete(filter);
      }),
  );

export class McpToolExposure extends Context.Service<
  McpToolExposure,
  {
    /** Finds tools for the query and lists them to the thread's sessions from now on. */
    readonly search: (threadId: string, query: string) => Effect.Effect<ReadonlyArray<ListedTool>>;
    readonly isListed: (threadId: string, tool: string) => boolean;
  }
>()("t3/mcp/McpToolExposure") {}

const score = (tool: ListedTool, terms: ReadonlyArray<string>) => {
  const name = tool.name.toLowerCase();
  const description = tool.description.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (term === name) total += 100;
    else if (name.includes(term)) total += 3;
    else if (description.includes(term)) total += 1;
  }
  return total;
};

const searchableBy = Effect.fnUntraced(function* (tool: SearchableTool) {
  if (tool.enabledWhen !== undefined) {
    const request = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpRequestContext));
    const enabled = tool.enabledWhen({
      protocolVersion: request?.protocolVersion ?? "",
      capabilities: request?.clientCapabilities ?? {},
      clientInfo: request?.clientInfo,
    });
    if (!enabled) return false;
  }
  for (const filter of searchFilters) {
    if (!(yield* filter(tool.name))) return false;
  }
  return true;
});

/**
 * Loaded tools are kept per thread, not per MCP credential: a thread whose provider
 * restarts gets a new credential, and its model still expects the tools it used.
 */
export const make = (
  tools: () => ReadonlyArray<SearchableTool>,
  announceListChanged: () => Effect.Effect<void>,
) => {
  const loaded = new Map<string, Set<string>>();
  const load = (threadId: string, names: ReadonlyArray<string>) => {
    const listed = loaded.get(threadId) ?? new Set<string>();
    loaded.delete(threadId);
    loaded.set(threadId, listed);
    for (const name of names) {
      if (DIRECT_TOOLS.has(name)) continue;
      listed.delete(name);
      listed.add(name);
    }
    for (const oldest of listed) {
      if (listed.size <= MAX_LOADED) break;
      listed.delete(oldest);
    }
    for (const oldest of loaded.keys()) {
      if (loaded.size <= MAX_THREADS) break;
      loaded.delete(oldest);
    }
  };
  return McpToolExposure.of({
    search: Effect.fn("McpToolExposure.search")(function* (threadId, query) {
      const terms = query
        .toLowerCase()
        .split(/[^a-z0-9_]+/u)
        .filter(Boolean);
      const ranked = tools()
        .filter((tool) => tool.name !== TOOL_SEARCH)
        .map((tool) => ({ tool, score: score(tool, terms) }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score);
      const found: Array<ListedTool> = [];
      for (const { tool } of ranked) {
        if (found.length >= MAX_RESULTS) break;
        if (yield* searchableBy(tool))
          found.push({ name: tool.name, description: tool.description });
      }
      if (found.length > 0) {
        load(
          threadId,
          found.map((tool) => tool.name),
        );
        yield* announceListChanged();
      }
      return found;
    }),
    isListed: (threadId, tool) =>
      DIRECT_TOOLS.has(tool) || loaded.get(threadId)?.has(tool) === true,
  });
};
