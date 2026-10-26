import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";
import { currentUserInstructionsBlock } from "@t3tools/provider-core/server/userInstructions";

import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
} from "@t3tools/provider-core/server/orchestrationInstructions";
import type { ToolCallHint } from "./ToolCallHints.ts";

/** The name Codex gets the T3 MCP server under in its `mcp_servers` config. */
export const CODEX_T3_MCP_SERVER = "t3-code";

/**
 * How Codex code mode names a T3 MCP tool in exec: the server name with
 * characters other than letters, digits and `_` replaced by `_`.
 */
const codexCodeModeToolName = (tool: string) =>
  `tools.mcp__${CODEX_T3_MCP_SERVER.replace(/[^A-Za-z0-9_]/g, "_")}__${tool}`;

const toolCallHintInstructions = (hints: ReadonlyArray<ToolCallHint>) =>
  `In Codex code mode, call these Up.computer tools in exec directly, without an ALL_TOOLS lookup: ${hints
    .map(({ name, args }) => `\`${codexCodeModeToolName(name)}(${args})\``)
    .join(", ")}.`;

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

const T3_CODE_DEVICE_TOOL_INSTRUCTIONS = `## Up.computer devices

For iOS Simulators and Android Emulators here, call \`device_list\`, then \`device_open\`. Drive the device with the exact \`agent-device\` launcher and flags it returns, on every command. Prefer \`agent-device snapshot -i\` refs over coordinates. Use \`device_screenshot\` to see the screen. Use \`xcrun simctl\` or \`adb\` only for builds, logs, and ports. If a platform is unavailable, say so.`;

export interface T3CodeToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
  /** False omits the orchestration block; see `orchestrationInstructionsFor`. */
  readonly orchestration?: boolean;
  /** Tools to name with their exec call shape; see `toolCallHintsFor`. */
  readonly toolCallHints?: ReadonlyArray<ToolCallHint>;
}

const normalizeAvailability = (
  availability: boolean | T3CodeToolAvailability,
): T3CodeToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (availability: boolean | T3CodeToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  return [
    tools.browser ? T3_CODE_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? T3_CODE_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | T3CodeToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = toolInstructions(toolsAvailable);
  const orchestration = normalizeAvailability(toolsAvailable).orchestration !== false;
  const toolCallHints = normalizeAvailability(toolsAvailable).toolCallHints ?? [];
  const userInstructions = currentUserInstructionsBlock();
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...(orchestration
      ? Object.fromEntries(
          T3_CODE_ORCHESTRATION_SECTIONS.map((section, index) => [
            `t3_code_orchestration_${String(index + 1).padStart(2, "0")}`,
            { kind: "application" as const, value: section },
          ]),
        )
      : {}),
    t3_code_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime, omitUserInstructions: true }),
    },
    ...(tools ? { t3_code_tools: { kind: "application", value: tools } } : {}),
    ...(toolCallHints.length > 0
      ? {
          t3_code_tool_calls: {
            kind: "application",
            value: toolCallHintInstructions(toolCallHints),
          },
        }
      : {}),
    ...(userInstructions
      ? { user_instructions: { kind: "application", value: userInstructions } }
      : {}),
  };
}
