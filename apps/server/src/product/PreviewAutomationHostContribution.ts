import type {
  PreviewAutomationOperation,
  PreviewAutomationRemoteError,
  PreviewAutomationRequest,
} from "@upcomputer/contracts";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { ServerConfig } from "../config.ts";

/**
 * A preview automation host that runs inside the server process.
 *
 * The `preview_*` MCP tools reach a browser through `PreviewAutomationBroker`.
 * Desktop clients connect to it over WebSocket. A product can also contribute
 * a host that runs in the server, for example a managed external browser. The
 * broker sends that host the same `PreviewAutomationRequest` a desktop host
 * receives and turns its failures into the same typed errors, so agents see
 * one tool contract whichever host serves them.
 *
 * For each call the broker picks, in order:
 * 1. a server host whose `preferred` is true;
 * 2. the host the provider session already uses, while it stays connected, so
 *    page and cookie state do not jump between browsers mid-session;
 * 3. a connected desktop host for the environment;
 * 4. a server host.
 *
 * Only hosts that support the operation qualify. A server host serves every
 * environment of the server it runs in.
 *
 * @experimental
 */
export interface ExperimentalPreviewAutomationHost {
  readonly supportedOperations: ReadonlyArray<PreviewAutomationOperation>;
  /** Read on every call. While true, calls route here even when a desktop host is connected. */
  readonly preferred: Effect.Effect<boolean>;
  /**
   * Runs one request. `request.tabId` is the session's current tab (or the
   * explicit target); results that carry a `tabId` update it. Fail with the
   * remote error tags desktop hosts use, such as
   * `PreviewAutomationTargetNotFoundError`.
   */
  readonly execute: (
    request: PreviewAutomationRequest,
  ) => Effect.Effect<unknown, PreviewAutomationRemoteError>;
}

/** Services a server-side host may use while it is built. */
export type ExperimentalPreviewAutomationHostEnv = ServerConfig | Scope.Scope;

/** Trusted build-time registration for a server-side preview automation host. */
export interface ExperimentalPreviewAutomationHostContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  /** Builds the host once per server runtime; the scope closes with the server. */
  readonly make: Effect.Effect<
    ExperimentalPreviewAutomationHost,
    never,
    ExperimentalPreviewAutomationHostEnv
  >;
}
