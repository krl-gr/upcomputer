import type { ComputerUseSettings } from "@t3tools/computer-use-contracts/settings";

import {
  type ComputerUseToolDefinition,
  getComputerUseToolDefinition,
  sanitizeComputerUseArgs,
  summarizeComputerUseArgs,
} from "./ComputerUseToolDefinitions.ts";
import { isSensitiveApp } from "./SensitiveApps.ts";

/**
 * What a thread's interaction mode allows: `allow` observes and controls,
 * `observe-only` only reads, `deny` refuses every computer-use tool.
 */
export interface ComputerUseInteractionMode {
  readonly displayName: string;
  readonly safety: { readonly computerUse: "allow" | "observe-only" | "deny" };
}

export interface ComputerUsePolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiresApproval: boolean;
  readonly sanitizedArgs: Record<string, unknown>;
  readonly detail: string;
}

function usesCoordinates(args: Record<string, unknown>): boolean {
  return (
    typeof args.x === "number" ||
    typeof args.y === "number" ||
    typeof args.fromX === "number" ||
    typeof args.fromY === "number" ||
    typeof args.toX === "number" ||
    typeof args.toY === "number"
  );
}

/** Whether the tool acts on one app, judged by its definition, not by the arguments passed. */
function targetsApp(tool: ComputerUseToolDefinition): boolean {
  const properties = tool.inputSchema.properties;
  return (
    tool.mode === "action" ||
    (typeof properties === "object" && properties !== null && "app" in properties)
  );
}

/**
 * The allowlist applies only to tools that target an app; such a tool without `app` is refused.
 * Every screenshot targets an app, so the allowlist also rules out whole-screen captures.
 */
function appAllowed(
  settings: ComputerUseSettings,
  tool: ComputerUseToolDefinition,
  args: Record<string, unknown>,
): boolean {
  if (settings.allowedApps.length === 0 || !targetsApp(tool)) {
    return true;
  }
  const app = typeof args.app === "string" ? args.app.trim().toLowerCase() : "";
  if (!app) {
    return false;
  }
  return settings.allowedApps.some((entry) => entry.trim().toLowerCase() === app);
}

export function evaluateComputerUsePolicy(input: {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly settings: ComputerUseSettings;
  readonly interactionMode?: ComputerUseInteractionMode;
}): ComputerUsePolicyDecision {
  const sanitizedArgs = sanitizeComputerUseArgs(input.args);
  const detail = summarizeComputerUseArgs(input.toolName, input.args);
  const tool = getComputerUseToolDefinition(input.toolName);
  if (!tool) {
    return {
      allowed: false,
      reason: `Unknown computer-use tool: ${input.toolName}.`,
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (!input.settings.enabled) {
    return {
      allowed: false,
      reason: "Computer use is disabled in Settings.",
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (!appAllowed(input.settings, tool, input.args)) {
    return {
      allowed: false,
      reason: "Computer action blocked: target app is not in the allowed apps list.",
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (input.interactionMode?.safety.computerUse === "deny") {
    return {
      allowed: false,
      reason: `Computer use is unavailable in ${input.interactionMode.displayName} mode.`,
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (isSensitiveApp(input.args.app)) {
    return {
      allowed: false,
      reason: "Computer action blocked: target app looks like a credential or payment surface.",
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (tool.mode === "observe") {
    return {
      allowed: true,
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (input.settings.mode !== "control") {
    return {
      allowed: false,
      reason: "Computer control mode is disabled in Settings.",
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (input.interactionMode?.safety.computerUse === "observe-only") {
    return {
      allowed: false,
      reason: `Computer control actions are unavailable in ${input.interactionMode.displayName} mode.`,
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  if (!input.settings.allowCoordinateFallback && usesCoordinates(input.args)) {
    return {
      allowed: false,
      reason: "Coordinate-based computer control is disabled in Settings.",
      requiresApproval: false,
      sanitizedArgs,
      detail,
    };
  }

  return {
    allowed: true,
    requiresApproval: input.settings.requireActionApproval,
    sanitizedArgs,
    detail,
  };
}
