import type { ComputerUseSettings } from "@upcomputer/computer-use-contracts/settings";
import type { ResolvedInteractionMode } from "@upcomputer/shared/interactionMode";

import {
  getComputerUseToolDefinition,
  sanitizeComputerUseArgs,
  summarizeComputerUseArgs,
} from "./ComputerUseToolDefinitions.ts";

/** The parts of an interaction mode the policy reads; a resolved mode or a mode descriptor. */
export type ComputerUseInteractionMode = Pick<ResolvedInteractionMode, "displayName" | "safety">;

export interface ComputerUsePolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiresApproval: boolean;
  readonly sanitizedArgs: Record<string, unknown>;
  readonly detail: string;
}

/**
 * Matched as substrings against the `app` argument, which may be a visible
 * name (possibly localized) or a bundle identifier, so plurals and IDs such as
 * `com.apple.Passwords` or `com.agilebits.onepassword7` are caught too.
 */
const SENSITIVE_APP_PATTERNS = [
  /pass(?:word|wd)/i,
  /keychain/i,
  /bitwarden/i,
  /dashlane/i,
  /lastpass/i,
  /keepass/i,
  /enpass/i,
  /proton\s*pass/i,
  /wallet/i,
  /payment/i,
  /парол/iu,
  /связка ключей/iu,
] as const;

function isSensitiveApp(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return SENSITIVE_APP_PATTERNS.some((pattern) => pattern.test(value));
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

function appAllowed(settings: ComputerUseSettings, args: Record<string, unknown>): boolean {
  if (settings.allowedApps.length === 0) {
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

  if (!appAllowed(input.settings, input.args)) {
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
