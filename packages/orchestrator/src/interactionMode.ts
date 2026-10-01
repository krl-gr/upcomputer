import type { InteractionModeDescriptor } from "@upcomputer/contracts";
import type { ExperimentalInteractionModeRegistration } from "@upcomputer/shared/interactionMode";
import type { ExperimentalProductExtensionRegistration } from "@upcomputer/shared/product";

import {
  ORCHESTRATOR_MODE_INSTRUCTIONS,
  ORCHESTRATOR_USER_PROMPT_PREFIX,
  applyOrchestratorModePromptPrefix,
} from "./instructions.ts";
import { parseOrchestrationProposalMarkdown } from "./parser.ts";
import { ORCHESTRATOR_UI_METADATA } from "./ui.ts";

export const ORCHESTRATOR_PROVIDER_RUNTIME_HINTS = {
  codex: {
    collaborationMode: "plan",
    sandbox: "read-only",
  },
  claudeAgent: {
    permissionMode: "plan",
    restorePermissionModeAfterTurn: true,
  },
  cursor: {
    nativeModeAliases: ["orchestrator", "orchestration"],
    safeFallbackModeAliases: ["plan", "architect"],
    rejectWhenNoSafeNativeMode: true,
  },
  opencode: {
    agent: "plan",
    allowUserAgentOverride: false,
  },
} as const;

export const ORCHESTRATOR_INTERACTION_MODE_CAPABILITY_ID =
  "upcomputer.orchestrator.interaction-mode.v1" as const;
export const ORCHESTRATOR_INTERACTION_MODE_CAPABILITY = {
  id: ORCHESTRATOR_INTERACTION_MODE_CAPABILITY_ID,
  version: 1,
} as const;

export const ORCHESTRATOR_INTERACTION_MODE_DESCRIPTOR = {
  id: "orchestrator",
  ownerId: "upcomputer.orchestrator",
  version: 1,
  displayName: ORCHESTRATOR_UI_METADATA.displayName,
  description: ORCHESTRATOR_UI_METADATA.description,
  intent: "propose",
  safety: {
    mutations: "deny",
    sandbox: "read-only",
    computerUse: "observe-only",
  },
  outputKind: "structured",
  supportedProviders: ["codex", "claudeAgent", "cursor", "opencode"],
  unsupportedProviderBehavior: "reject",
  providerBehaviors: [
    {
      providerId: "codex",
      collaborationMode: "plan",
      sandbox: "read-only",
      developerInstructions: ORCHESTRATOR_MODE_INSTRUCTIONS,
    },
    {
      providerId: "claudeAgent",
      permissionMode: "plan",
      sandbox: "read-only",
      promptPrefix: ORCHESTRATOR_USER_PROMPT_PREFIX,
    },
    {
      providerId: "cursor",
      nativeMode: "plan",
      nativeModeFallback: "reject",
      sandbox: "read-only",
      promptPrefix: ORCHESTRATOR_USER_PROMPT_PREFIX,
    },
    {
      providerId: "opencode",
      nativeMode: "plan",
      nativeModePrecedence: "descriptor-first",
      sandbox: "read-only",
      promptPrefix: ORCHESTRATOR_USER_PROMPT_PREFIX,
    },
  ],
} as const satisfies InteractionModeDescriptor;

export const ORCHESTRATOR_INTERACTION_MODE_REGISTRATION = {
  descriptor: ORCHESTRATOR_INTERACTION_MODE_DESCRIPTOR,
  transformPrompt: (text) => applyOrchestratorModePromptPrefix(text),
  parseFinalOutput: (text) => parseOrchestrationProposalMarkdown(text),
} satisfies ExperimentalInteractionModeRegistration;

export const ORCHESTRATOR_FEATURE_ID = "upcomputer.orchestrator" as const;

/** Server contribution that registers the Orchestrator interaction mode. */
export const ORCHESTRATOR_SERVER_FEATURE = {
  id: ORCHESTRATOR_FEATURE_ID,
  version: 1,
  interactionModes: [ORCHESTRATOR_INTERACTION_MODE_REGISTRATION],
} as const;

/** Product-manifest entry advertising the Orchestrator interaction mode. */
export const ORCHESTRATOR_PRODUCT_EXTENSION = {
  id: ORCHESTRATOR_FEATURE_ID,
  displayName: "Orchestrator",
  description: "Read-only planning mode with structured implementation proposals.",
  version: "1.0.0",
  source: "core",
  availability: "free",
  enabled: true,
  capabilities: [ORCHESTRATOR_INTERACTION_MODE_CAPABILITY],
} as const satisfies ExperimentalProductExtensionRegistration;
