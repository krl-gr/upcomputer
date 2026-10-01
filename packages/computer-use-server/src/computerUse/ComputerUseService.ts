import {
  COMPUTER_USE_DEFAULT_BINARY_PATH,
  COMPUTER_USE_DEFAULT_MCP_ARGS,
  ComputerUseSettings as ComputerUseSettingsSchema,
  type ComputerUseDoctorResult,
  type ComputerUseSettings,
  type ComputerUseSnapshot,
  type ComputerUseToolSnapshot,
} from "@upcomputer/computer-use-contracts/settings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../../../apps/server/src/config.ts";
import { collectUint8StreamText } from "../../../../apps/server/src/stream/collectUint8StreamText.ts";
import { evaluateComputerUsePolicy, type ComputerUseInteractionMode } from "./ComputerUsePolicy.ts";
import { normalizeComputerUseBackendArgs } from "./ComputerUseBackendArgs.ts";
import {
  COMPUTER_USE_NAMESPACE,
  COMPUTER_USE_TOOLS,
  COMPUTER_USE_TOOL_PREFIX,
  getComputerUseToolDefinition,
} from "./ComputerUseToolDefinitions.ts";
import {
  McpComputerUseClient,
  type McpToolCallResult,
  type McpToolContent,
} from "./McpComputerUseClient.ts";
import { resolveManagedComputerUseBinaryPath } from "./ManagedComputerUseSidecar.ts";

const decodeComputerUseSettings = Schema.decodeUnknownSync(
  Schema.Struct({
    computerUse: Schema.optionalKey(Schema.Unknown),
  }),
);
const decodeSettings = Schema.decodeUnknownSync(ComputerUseSettingsSchema);
const DOCTOR_TIMEOUT = "20 seconds" as const;
const DOCTOR_MAX_OUTPUT_BYTES = 1024 * 1024;

type ComputerUseContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface ComputerUseServiceDependencies {
  readonly fileSystem: FileSystem.FileSystem;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}

export interface ComputerUseToolResult {
  readonly content: ReadonlyArray<ComputerUseContent>;
  readonly details: Record<string, unknown>;
  readonly isError: boolean;
  readonly persistenceScreenshot?: {
    readonly data: string;
    readonly mimeType: string;
    readonly app?: string;
  };
}

export interface ComputerUseDynamicToolSpec {
  readonly name: string;
  readonly namespace: typeof COMPUTER_USE_NAMESPACE;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface ComputerUseServiceShape {
  readonly snapshot: () => Promise<ComputerUseSnapshot>;
  readonly restart: () => Promise<ComputerUseSnapshot>;
  readonly stop: () => Promise<ComputerUseSnapshot>;
  readonly refreshTools: () => Promise<ComputerUseSnapshot>;
  readonly doctor: () => Promise<ComputerUseDoctorResult>;
  readonly activeToolNames: (
    interactionMode?: ComputerUseInteractionMode,
  ) => Promise<ReadonlyArray<string>>;
  readonly dynamicToolSpecs: () => Promise<ReadonlyArray<ComputerUseDynamicToolSpec>>;
  readonly callTool: (input: {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly interactionMode?: ComputerUseInteractionMode;
  }) => Promise<ComputerUseToolResult>;
  readonly shouldRequireApproval: (input: {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly interactionMode?: ComputerUseInteractionMode;
  }) => Promise<{ readonly required: boolean; readonly detail: string }>;
}

export class ComputerUseService extends Context.Service<
  ComputerUseService,
  ComputerUseServiceShape
>()("@upcomputer/computer-use-server/computerUse/ComputerUseService") {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSettings(settings: ComputerUseSettings): ComputerUseSettings {
  return {
    ...settings,
    binaryPath: settings.binaryPath.trim() || COMPUTER_USE_DEFAULT_BINARY_PATH,
    mcpArgs:
      settings.mcpArgs.length > 0
        ? settings.mcpArgs.map((arg) => arg.trim()).filter(Boolean)
        : [...COMPUTER_USE_DEFAULT_MCP_ARGS],
  };
}

function executionSettings(settings: ComputerUseSettings): ComputerUseSettings {
  return {
    ...settings,
    binaryPath: resolveManagedComputerUseBinaryPath({ configuredPath: settings.binaryPath }),
  };
}

async function readComputerUseSettings(
  settingsPath: string,
  dependencies: ComputerUseServiceDependencies,
): Promise<ComputerUseSettings> {
  const raw = await Effect.runPromise(
    dependencies.fileSystem.readFileString(settingsPath).pipe(Effect.orElseSucceed(() => "")),
  );
  if (!raw.trim()) {
    return normalizeSettings(decodeSettings({}));
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const envelope = decodeComputerUseSettings(parsed);
    return normalizeSettings(decodeSettings(envelope.computerUse ?? {}));
  } catch {
    return normalizeSettings(decodeSettings({}));
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function currentIsoTimestamp(): Promise<string> {
  return Effect.runPromise(DateTime.now.pipe(Effect.map(DateTime.formatIso)));
}

async function runComputerUseDoctor(
  settings: ComputerUseSettings,
  dependencies: ComputerUseServiceDependencies,
) {
  const program = Effect.scoped(
    Effect.gen(function* () {
      const child = yield* dependencies.childProcessSpawner.spawn(
        ChildProcess.make(settings.binaryPath, ["doctor"], {}),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectUint8StreamText({
            stream: child.stdout,
            maxBytes: DOCTOR_MAX_OUTPUT_BYTES,
          }),
          collectUint8StreamText({
            stream: child.stderr,
            maxBytes: DOCTOR_MAX_OUTPUT_BYTES,
          }),
          child.exitCode.pipe(Effect.map(Number)),
        ],
        { concurrency: "unbounded" },
      );
      return {
        ...(exitCode === 0 ? {} : { exitCode }),
        stdout: stdout.text,
        stderr: stderr.text,
      };
    }).pipe(Effect.timeout(DOCTOR_TIMEOUT)),
  );

  return Effect.runPromise(program).catch((error) => ({
    exitCode: 1,
    stdout: "",
    stderr: formatError(error),
  }));
}

function textContent(text: string): ComputerUseContent {
  return { type: "text", text };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeMcpContent(
  content: ReadonlyArray<McpToolContent> | undefined,
): ComputerUseContent[] {
  const normalized: ComputerUseContent[] = [];
  for (const item of content ?? []) {
    if (!isRecord(item)) {
      normalized.push(textContent(stringifyUnknown(item)));
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      normalized.push(textContent(item.text));
      continue;
    }
    if (item.type === "image" && typeof item.data === "string") {
      normalized.push({
        type: "image",
        data: item.data,
        mimeType: typeof item.mimeType === "string" ? item.mimeType : "image/png",
      });
      continue;
    }
    normalized.push(textContent(stringifyUnknown(item)));
  }
  return normalized;
}

function resultFromMcp(input: {
  readonly toolName: string;
  readonly backendName: string;
  readonly args: Record<string, unknown>;
  readonly result: McpToolCallResult;
}): ComputerUseToolResult {
  const content = normalizeMcpContent(input.result.content);
  const fallbackContent =
    content.length > 0 ? content : [textContent(stringifyUnknown(input.result))];
  const firstImage = fallbackContent.find(
    (item): item is Extract<ComputerUseContent, { type: "image" }> => item.type === "image",
  );
  return {
    content: fallbackContent,
    details: {
      kind: "computerUse",
      action: input.toolName,
      backendName: input.backendName,
      args: input.args,
    },
    isError: input.result.isError === true,
    ...(firstImage
      ? {
          persistenceScreenshot: {
            data: firstImage.data,
            mimeType: firstImage.mimeType,
            ...(typeof input.args.app === "string" ? { app: input.args.app } : {}),
          },
        }
      : {}),
  };
}

function blockedResult(input: {
  readonly toolName: string;
  readonly reason: string;
  readonly args: Record<string, unknown>;
}): ComputerUseToolResult {
  return {
    content: [textContent(input.reason)],
    details: {
      kind: "computerUse",
      action: input.toolName,
      blocked: true,
      reason: input.reason,
      args: input.args,
    },
    isError: true,
  };
}

function doctorStatus(result: {
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
}): ComputerUseDoctorResult["status"] {
  if (result.exitCode !== undefined && result.exitCode !== 0) {
    return "error";
  }
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return combined.includes("warning") || combined.includes("missing") ? "warning" : "ok";
}

function activeToolsForSettings(
  settings: ComputerUseSettings,
  interactionMode?: ComputerUseInteractionMode,
): ReadonlyArray<string> {
  if (!settings.enabled) {
    return [];
  }
  if (interactionMode?.safety.computerUse === "deny") {
    return [];
  }
  if (settings.mode !== "control" || interactionMode?.safety.computerUse === "observe-only") {
    return COMPUTER_USE_TOOLS.filter((tool) => tool.mode === "observe").map((tool) => tool.name);
  }
  return COMPUTER_USE_TOOLS.map((tool) => tool.name);
}

function dynamicToolsForSettings(
  settings: ComputerUseSettings,
): ReadonlyArray<ComputerUseDynamicToolSpec> {
  return activeToolsForSettings(settings).map((toolName) => {
    const tool = getComputerUseToolDefinition(toolName);
    if (!tool) {
      throw new Error(`Unknown computer-use tool '${toolName}'.`);
    }
    return {
      name: tool.name,
      namespace: COMPUTER_USE_NAMESPACE,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  });
}

function toolSnapshots(backendToolNames: ReadonlySet<string>): ComputerUseToolSnapshot[] {
  return COMPUTER_USE_TOOLS.map((tool) => ({
    name: tool.name,
    backendName: tool.backendName,
    mode: tool.mode,
    available:
      backendToolNames.has(tool.backendName) ||
      (tool.name === "computer_screenshot" && backendToolNames.has("get_app_state")),
  }));
}

function missingRequiredTools(backendToolNames: ReadonlySet<string>): string[] {
  return COMPUTER_USE_TOOLS.filter(
    (tool) => tool.required && !backendToolNames.has(tool.backendName),
  ).map((tool) => tool.backendName);
}

export function createComputerUseService(
  serverConfig: ServerConfig["Service"],
  dependencies: ComputerUseServiceDependencies,
): ComputerUseServiceShape {
  const client = new McpComputerUseClient({
    doctorRunner: (settings) => runComputerUseDoctor(settings, dependencies),
  });
  let status: ComputerUseSnapshot["status"] = "stopped";
  let lastError: string | undefined;
  let lastDoctor: ComputerUseDoctorResult | undefined;
  let lastBackendToolNames = new Set<string>();

  const readSettings = () => readComputerUseSettings(serverConfig.settingsPath, dependencies);

  const snapshotFor = async (settings: ComputerUseSettings): Promise<ComputerUseSnapshot> => {
    const effectiveStatus: ComputerUseSnapshot["status"] = settings.enabled ? status : "disabled";
    let command = settings.binaryPath;
    try {
      command = executionSettings(settings).binaryPath;
    } catch {
      // Keep settings inspectable when a managed binary is missing. Start/doctor
      // still report the actionable resolution error through the normal status path.
    }
    return {
      status: effectiveStatus,
      command,
      args: [...settings.mcpArgs],
      tools: toolSnapshots(lastBackendToolNames),
      missingRequiredTools: missingRequiredTools(lastBackendToolNames),
      ...(lastError ? { lastError } : {}),
      ...(lastDoctor ? { doctor: lastDoctor } : {}),
      settings,
    };
  };

  const refreshTools = async () => {
    const settings = await readSettings();
    if (!settings.enabled) {
      status = "stopped";
      lastBackendToolNames = new Set();
      return snapshotFor(settings);
    }
    try {
      status = "starting";
      const tools = await client.listTools(executionSettings(settings), { refresh: true });
      lastBackendToolNames = new Set(tools.map((tool) => tool.name));
      status = "ready";
      lastError = undefined;
    } catch (error) {
      status = "error";
      lastError = error instanceof Error ? error.message : String(error);
    }
    return snapshotFor(settings);
  };

  return {
    snapshot: async () => snapshotFor(await readSettings()),
    restart: async () => {
      const settings = await readSettings();
      if (!settings.enabled) {
        await client.stop();
        status = "stopped";
        lastBackendToolNames = new Set();
        return snapshotFor(settings);
      }
      try {
        status = "starting";
        const resolvedSettings = executionSettings(settings);
        await client.restart(resolvedSettings);
        const tools = await client.listTools(resolvedSettings, { refresh: true });
        lastBackendToolNames = new Set(tools.map((tool) => tool.name));
        status = "ready";
        lastError = undefined;
      } catch (error) {
        status = "error";
        lastError = error instanceof Error ? error.message : String(error);
      }
      return snapshotFor(settings);
    },
    stop: async () => {
      await client.stop();
      status = "stopped";
      lastBackendToolNames = new Set();
      return snapshotFor(await readSettings());
    },
    refreshTools,
    doctor: async () => {
      const settings = await readSettings();
      const result = await client.doctor(executionSettings(settings));
      lastDoctor = {
        status: doctorStatus(result),
        checkedAt: await currentIsoTimestamp(),
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        stdout: result.stdout,
        stderr: result.stderr,
      };
      return lastDoctor;
    },
    activeToolNames: async (interactionMode) =>
      activeToolsForSettings(await readSettings(), interactionMode),
    dynamicToolSpecs: async () => dynamicToolsForSettings(await readSettings()),
    shouldRequireApproval: async (input) => {
      const settings = await readSettings();
      const decision = evaluateComputerUsePolicy({ ...input, settings });
      return { required: decision.requiresApproval, detail: decision.detail };
    },
    callTool: async (input) => {
      const settings = await readSettings();
      const tool = getComputerUseToolDefinition(input.toolName);
      if (!tool || !input.toolName.startsWith(COMPUTER_USE_TOOL_PREFIX)) {
        return blockedResult({
          toolName: input.toolName,
          reason: `Unknown computer-use tool: ${input.toolName}.`,
          args: {},
        });
      }
      const decision = evaluateComputerUsePolicy({ ...input, settings });
      if (!decision.allowed) {
        return blockedResult({
          toolName: input.toolName,
          reason: decision.reason ?? "Computer-use tool call blocked.",
          args: decision.sanitizedArgs,
        });
      }
      try {
        status = "starting";
        const backendArgs = normalizeComputerUseBackendArgs(tool.backendName, input.args);
        const result = await client.callTool({
          settings: executionSettings(settings),
          backendName: tool.backendName,
          args: backendArgs,
        });
        status = "ready";
        lastError = undefined;
        return resultFromMcp({
          toolName: input.toolName,
          backendName: tool.backendName,
          args: decision.sanitizedArgs,
          result,
        });
      } catch (error) {
        status = "error";
        lastError = error instanceof Error ? error.message : String(error);
        return blockedResult({
          toolName: input.toolName,
          reason: lastError,
          args: decision.sanitizedArgs,
        });
      }
    },
  };
}

const services = new Map<string, ComputerUseServiceShape>();

export function getComputerUseService(
  serverConfig: ServerConfig["Service"],
  dependencies: ComputerUseServiceDependencies,
): ComputerUseServiceShape {
  const existing = services.get(serverConfig.stateDir);
  if (existing) {
    return existing;
  }
  const service = createComputerUseService(serverConfig, dependencies);
  services.set(serverConfig.stateDir, service);
  return service;
}

export const makeComputerUseService = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return getComputerUseService(serverConfig, { fileSystem, childProcessSpawner });
});

export const ComputerUseServiceLive = Layer.effect(ComputerUseService, makeComputerUseService);

export function computerUseResultToCodexContentItems(result: ComputerUseToolResult) {
  return result.content.map((item) => {
    if (item.type === "image") {
      return {
        type: "inputImage" as const,
        imageUrl: `data:${item.mimeType};base64,${item.data}`,
      };
    }
    return {
      type: "inputText" as const,
      text: item.text,
    };
  });
}
