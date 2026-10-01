import type { ComputerUseSettings } from "@upcomputer/computer-use-contracts/settings";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { assertCoordinateClickSupported } from "./ComputerUseBackendArgs.ts";

interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export type McpToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType?: string }
  | Record<string, unknown>;

export interface McpToolCallResult {
  readonly content?: ReadonlyArray<McpToolContent>;
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

export interface ComputerUseDoctorCommandResult {
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ComputerUseDoctorRunner = (
  settings: ComputerUseSettings,
) => Promise<ComputerUseDoctorCommandResult>;

export class McpComputerUseClient {
  private readonly doctorRunner: ComputerUseDoctorRunner;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private starting: Promise<void> | null = null;
  private cachedTools: ReadonlyArray<McpTool> | null = null;
  private lastCommandKey = "";

  constructor(options?: { readonly doctorRunner?: ComputerUseDoctorRunner }) {
    this.doctorRunner =
      options?.doctorRunner ??
      (async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "Computer-use doctor runner is unavailable.",
      }));
  }

  async start(settings: ComputerUseSettings): Promise<void> {
    const commandKey = JSON.stringify([settings.binaryPath, settings.mcpArgs]);
    if (this.client && this.lastCommandKey === commandKey) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }

    this.starting = (async () => {
      await this.stop();
      const client = new Client({
        name: "upcomputer-computer-use",
        version: "0.0.0",
      });
      const transport = new StdioClientTransport({
        command: settings.binaryPath,
        args: [...settings.mcpArgs],
      });
      await client.connect(transport);
      // If the sidecar exits or crashes, forget it so the next call starts a
      // fresh one instead of failing on the dead connection until a manual
      // restart. The failed call itself is not retried: it may already have
      // clicked or typed.
      client.onclose = () => {
        if (this.client !== client) return;
        this.client = null;
        this.transport = null;
        this.cachedTools = null;
        this.lastCommandKey = "";
      };
      this.client = client;
      this.transport = transport;
      this.cachedTools = null;
      this.lastCommandKey = commandKey;
    })().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  async stop(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.cachedTools = null;
    this.lastCommandKey = "";

    await maybeClose(client);
    await maybeClose(transport);
  }

  async restart(settings: ComputerUseSettings): Promise<void> {
    await this.stop();
    await this.start(settings);
  }

  async listTools(settings: ComputerUseSettings, options?: { readonly refresh?: boolean }) {
    await this.start(settings);
    if (this.cachedTools && !options?.refresh) {
      return this.cachedTools;
    }

    const response = await this.requireClient().listTools();
    const tools = Array.isArray(response.tools) ? (response.tools as ReadonlyArray<McpTool>) : [];
    this.cachedTools = tools;
    return tools;
  }

  async callTool(input: {
    readonly settings: ComputerUseSettings;
    readonly backendName: string;
    readonly args: Record<string, unknown>;
  }): Promise<McpToolCallResult> {
    await this.start(input.settings);
    if (input.backendName === "click" && typeof input.args.click_method === "string") {
      const tools = await this.listTools(input.settings);
      assertCoordinateClickSupported(
        tools.find((tool) => tool.name === "click")?.inputSchema,
        input.args.click_method,
      );
    }
    return (await this.requireClient().callTool({
      name: input.backendName,
      arguments: input.args,
    })) as McpToolCallResult;
  }

  async doctor(settings: ComputerUseSettings): Promise<ComputerUseDoctorCommandResult> {
    return this.doctorRunner(settings);
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error("Computer-use MCP client is not running.");
    }
    return this.client;
  }
}

async function maybeClose(target: unknown): Promise<void> {
  const close =
    target && typeof target === "object" && "close" in target ? target.close : undefined;
  if (typeof close !== "function") {
    return;
  }
  await Promise.resolve(close.call(target)).catch(() => undefined);
}
