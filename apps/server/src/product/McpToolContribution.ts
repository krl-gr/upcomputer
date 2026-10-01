import type {
  InteractionModeDescriptorSnapshot,
  ProviderInstanceId,
  RuntimeMode,
  ThreadId,
} from "@upcomputer/contracts";
import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Scope from "effect/Scope";
import type { ChildProcessSpawner } from "effect/unstable/process";

import type { ServerConfig } from "../config.ts";

/**
 * The provider session calling a contributed MCP tool, resolved by core on
 * every call from the session's credential and its thread's current state.
 *
 * @experimental
 */
export interface ExperimentalMcpToolSession {
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  /** Undefined when the thread cannot be read. */
  readonly runtimeMode: RuntimeMode | undefined;
  /**
   * The thread's interaction mode; undefined when the thread cannot be read.
   * A mode that is no longer registered resolves to Default.
   */
  readonly interactionMode: InteractionModeDescriptorSnapshot | undefined;
  /** The mode's mutation policy; "deny" when the thread cannot be read. */
  readonly mutationPolicy: "allow" | "deny";
}

export type ExperimentalMcpToolContent =
  | { readonly type: "text"; readonly text: string }
  /** `data` is base64. */
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface ExperimentalMcpToolResult {
  readonly isError: boolean;
  readonly content: ReadonlyArray<ExperimentalMcpToolContent>;
}

/** One tool served by the `upcomputer` MCP server that every provider session receives. */
export interface ExperimentalMcpTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** Advertised as `readOnlyHint`. Tools enforce their own policy in `execute`. */
  readonly readOnly: boolean;
  readonly execute: (
    input: Record<string, unknown>,
    session: ExperimentalMcpToolSession,
  ) => Effect.Effect<ExperimentalMcpToolResult>;
}

/** Services contributed MCP tools may use while they are built. */
export type ExperimentalMcpToolEnv =
  | ServerConfig
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope;

/**
 * Trusted build-time registration of tools on the core `upcomputer` MCP
 * server, so every harness (Claude, Codex, OpenCode, Cursor, Grok, ...) can
 * call them.
 *
 * @experimental
 */
export interface ExperimentalMcpToolContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  /** Builds the tools once per server runtime; the scope closes with the server. */
  readonly make: Effect.Effect<ReadonlyArray<ExperimentalMcpTool>, never, ExperimentalMcpToolEnv>;
}
