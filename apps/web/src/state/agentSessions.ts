import { WS_METHODS } from "@upcomputer/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@upcomputer/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Scan of Claude Code / Codex home directories on an environment, surfacing
 * project candidates for project import. The scan walks the filesystem
 * server-side, so results are cached briefly and refreshed when the import
 * panel remounts.
 */
export const agentSessionScan = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:scan",
  tag: WS_METHODS.agentSessionsScan,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const agentSessionImport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:import",
  tag: WS_METHODS.agentSessionsImport,
});
