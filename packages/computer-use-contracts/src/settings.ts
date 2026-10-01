import { TrimmedString } from "@upcomputer/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const COMPUTER_USE_DEFAULT_BINARY_PATH = "managed" as const;
export const COMPUTER_USE_DEFAULT_MCP_ARGS = ["mcp"] as const;

export const ComputerUseMode = Schema.Literals(["observe", "control"]);
export type ComputerUseMode = typeof ComputerUseMode.Type;

export const ComputerUseToolMode = Schema.Literals(["observe", "action"]);
export type ComputerUseToolMode = typeof ComputerUseToolMode.Type;

export const ComputerUseBackendStatus = Schema.Literals([
  "disabled",
  "stopped",
  "starting",
  "ready",
  "error",
]);
export type ComputerUseBackendStatus = typeof ComputerUseBackendStatus.Type;

/** The `computerUse` section of the server settings file. */
export const ComputerUseSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  mode: ComputerUseMode.pipe(Schema.withDecodingDefault(Effect.succeed("control" as const))),
  binaryPath: TrimmedString.pipe(
    Schema.withDecodingDefault(Effect.succeed(COMPUTER_USE_DEFAULT_BINARY_PATH)),
  ),
  mcpArgs: Schema.Array(TrimmedString).pipe(
    Schema.withDecodingDefault(Effect.succeed([...COMPUTER_USE_DEFAULT_MCP_ARGS])),
  ),
  requireActionApproval: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  allowCoordinateFallback: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  allowedApps: Schema.Array(TrimmedString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ComputerUseSettings = typeof ComputerUseSettings.Type;

export const ComputerUseToolSnapshot = Schema.Struct({
  name: Schema.String,
  backendName: Schema.String,
  mode: ComputerUseToolMode,
  available: Schema.Boolean,
});
export type ComputerUseToolSnapshot = typeof ComputerUseToolSnapshot.Type;

export const ComputerUseDoctorResult = Schema.Struct({
  status: Schema.Literals(["ok", "warning", "error"]),
  checkedAt: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  stdout: Schema.String,
  stderr: Schema.String,
});
export type ComputerUseDoctorResult = typeof ComputerUseDoctorResult.Type;

export const ComputerUseSnapshot = Schema.Struct({
  status: ComputerUseBackendStatus,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  tools: Schema.Array(ComputerUseToolSnapshot),
  missingRequiredTools: Schema.Array(Schema.String),
  lastError: Schema.optional(Schema.String),
  doctor: Schema.optional(ComputerUseDoctorResult),
  settings: ComputerUseSettings,
});
export type ComputerUseSnapshot = typeof ComputerUseSnapshot.Type;
