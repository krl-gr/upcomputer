import { TrimmedNonEmptyString } from "@upcomputer/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

export const COMPUTER_USE_RPC_NAMESPACE = "upcomputer.computer-use.v1" as const;
export const COMPUTER_USE_RPC_CONTRACT_VERSION = 1 as const;
export const COMPUTER_USE_RPC_CAPABILITY_ID = "upcomputer.computer-use.rpc.v1" as const;
export const COMPUTER_USE_RPC_CAPABILITY = {
  id: COMPUTER_USE_RPC_CAPABILITY_ID,
  version: COMPUTER_USE_RPC_CONTRACT_VERSION,
} as const;

export const BrowserUseSnapshot = Schema.Struct({
  status: Schema.Literals(["closed", "open"]),
  /** Run the preview_* browser tools in Chrome even while the desktop app is open. */
  alwaysUseChrome: Schema.Boolean,
  profilePath: Schema.String,
  browserName: Schema.optional(Schema.Literals(["chrome", "msedge"])),
  currentUrl: Schema.optional(Schema.String),
  currentTitle: Schema.optional(Schema.String),
});
export type BrowserUseSnapshot = typeof BrowserUseSnapshot.Type;

export const ComputerUseRuntimeToolSnapshot = Schema.Struct({
  name: Schema.String,
  backendName: Schema.String,
  mode: Schema.Literals(["observe", "action"]),
  available: Schema.Boolean,
});

/** Settings as the settings page edits them; the server normalizes them before saving. */
export const ComputerUseSettingsInput = Schema.Struct({
  enabled: Schema.Boolean,
  mode: Schema.Literals(["observe", "control"]),
  binaryPath: Schema.String,
  mcpArgs: Schema.Array(Schema.String),
  requireActionApproval: Schema.Boolean,
  allowCoordinateFallback: Schema.Boolean,
  allowedApps: Schema.Array(Schema.String),
});
export type ComputerUseSettingsInput = typeof ComputerUseSettingsInput.Type;

export const ComputerUseRuntimeSnapshot = Schema.Struct({
  status: Schema.Literals(["disabled", "stopped", "starting", "ready", "error"]),
  managed: Schema.Boolean,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  mode: Schema.Literals(["observe", "control"]),
  actionApproval: Schema.Boolean,
  settings: ComputerUseSettingsInput,
  tools: Schema.Array(ComputerUseRuntimeToolSnapshot),
  missingRequiredTools: Schema.Array(Schema.String),
  lastError: Schema.optional(Schema.String),
  doctorStatus: Schema.optional(Schema.Literals(["ok", "warning", "error"])),
  doctorMessage: Schema.optional(Schema.String),
  checkedAt: Schema.optional(Schema.String),
});
export type ComputerUseRuntimeSnapshot = typeof ComputerUseRuntimeSnapshot.Type;

export const ComputerUseStateSnapshot = Schema.Struct({
  browser: BrowserUseSnapshot,
  computerUse: ComputerUseRuntimeSnapshot,
});
export type ComputerUseStateSnapshot = typeof ComputerUseStateSnapshot.Type;

const EmptyInput = Schema.Struct({});
export const BrowserOpenInput = Schema.Struct({ url: Schema.optional(Schema.String) });
export const BrowserSettingsInput = Schema.Struct({ alwaysUseChrome: Schema.Boolean });
export const ComputerUseSettingsUpdateInput = Schema.Struct({
  settings: ComputerUseSettingsInput,
});

export class ComputerUseRpcError extends Schema.TaggedErrorClass<ComputerUseRpcError>()(
  "ComputerUseRpcError",
  { message: TrimmedNonEmptyString },
) {}

export const COMPUTER_USE_RPC_METHODS = {
  snapshot: `${COMPUTER_USE_RPC_NAMESPACE}.snapshot`,
  openBrowser: `${COMPUTER_USE_RPC_NAMESPACE}.openBrowser`,
  closeBrowser: `${COMPUTER_USE_RPC_NAMESPACE}.closeBrowser`,
  clearBrowserProfile: `${COMPUTER_USE_RPC_NAMESPACE}.clearBrowserProfile`,
  updateBrowserSettings: `${COMPUTER_USE_RPC_NAMESPACE}.updateBrowserSettings`,
  startComputerUse: `${COMPUTER_USE_RPC_NAMESPACE}.startComputerUse`,
  stopComputerUse: `${COMPUTER_USE_RPC_NAMESPACE}.stopComputerUse`,
  doctorComputerUse: `${COMPUTER_USE_RPC_NAMESPACE}.doctorComputerUse`,
  refreshComputerUseTools: `${COMPUTER_USE_RPC_NAMESPACE}.refreshComputerUseTools`,
  updateComputerUseSettings: `${COMPUTER_USE_RPC_NAMESPACE}.updateComputerUseSettings`,
} as const;

const stateRpc = <const Tag extends string, Payload extends Schema.Top>(
  tag: Tag,
  payload: Payload,
) => Rpc.make(tag, { payload, success: ComputerUseStateSnapshot, error: ComputerUseRpcError });

export const ComputerUseSnapshotRpc = stateRpc(COMPUTER_USE_RPC_METHODS.snapshot, EmptyInput);
export const BrowserOpenRpc = stateRpc(COMPUTER_USE_RPC_METHODS.openBrowser, BrowserOpenInput);
export const BrowserCloseRpc = stateRpc(COMPUTER_USE_RPC_METHODS.closeBrowser, EmptyInput);
export const BrowserClearProfileRpc = stateRpc(
  COMPUTER_USE_RPC_METHODS.clearBrowserProfile,
  EmptyInput,
);
export const BrowserUpdateSettingsRpc = stateRpc(
  COMPUTER_USE_RPC_METHODS.updateBrowserSettings,
  BrowserSettingsInput,
);
export const ComputerUseStartRpc = stateRpc(COMPUTER_USE_RPC_METHODS.startComputerUse, EmptyInput);
export const ComputerUseStopRpc = stateRpc(COMPUTER_USE_RPC_METHODS.stopComputerUse, EmptyInput);
export const ComputerUseDoctorRpc = stateRpc(
  COMPUTER_USE_RPC_METHODS.doctorComputerUse,
  EmptyInput,
);
export const ComputerUseRefreshToolsRpc = stateRpc(
  COMPUTER_USE_RPC_METHODS.refreshComputerUseTools,
  EmptyInput,
);
export const ComputerUseUpdateSettingsRpc = stateRpc(
  COMPUTER_USE_RPC_METHODS.updateComputerUseSettings,
  ComputerUseSettingsUpdateInput,
);

export const ComputerUseRpcGroup = RpcGroup.make(
  ComputerUseSnapshotRpc,
  BrowserOpenRpc,
  BrowserCloseRpc,
  BrowserClearProfileRpc,
  BrowserUpdateSettingsRpc,
  ComputerUseStartRpc,
  ComputerUseStopRpc,
  ComputerUseDoctorRpc,
  ComputerUseRefreshToolsRpc,
  ComputerUseUpdateSettingsRpc,
);
