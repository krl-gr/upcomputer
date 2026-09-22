import type { InteractionModeDescriptor } from "@upcomputer/contracts";
import {
  createExperimentalInteractionModeRegistry,
  type ExperimentalInteractionModeRegistration,
} from "@upcomputer/shared/interactionMode";

import {
  ASK_MODE_PROMPT_PREFIX,
  DEFAULT_MODE_PROMPT_PREFIX,
} from "../provider/AskModeInstructions.ts";
import {
  CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../provider/CodexDeveloperInstructions.ts";

const CORE_INTERACTION_MODE_OWNER_ID = "upcomputer.core";

const DEFAULT_INTERACTION_MODE = {
  id: "default",
  ownerId: CORE_INTERACTION_MODE_OWNER_ID,
  version: 1,
  displayName: "Default",
  description: "Work normally with the permissions selected for the provider session.",
  intent: "execute",
  safety: {
    mutations: "allow",
    sandbox: "inherit-runtime",
    computerUse: "allow",
  },
  outputKind: "plain",
  supportedProviders: ["codex", "claudeAgent", "cursor", "opencode"],
  unsupportedProviderBehavior: "reject",
  providerBehaviors: [
    {
      providerId: "codex",
      collaborationMode: "default",
      developerInstructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
    },
    {
      providerId: "claudeAgent",
      permissionMode: "session-default",
      promptPrefix: DEFAULT_MODE_PROMPT_PREFIX,
    },
    {
      providerId: "cursor",
      nativeMode: "runtime-default",
      nativeModeFallback: "unchanged",
    },
    {
      providerId: "opencode",
      nativeModePrecedence: "user-first",
      promptPrefix: DEFAULT_MODE_PROMPT_PREFIX,
    },
  ],
} satisfies InteractionModeDescriptor;

const ASK_INTERACTION_MODE = {
  id: "ask",
  ownerId: CORE_INTERACTION_MODE_OWNER_ID,
  version: 1,
  displayName: "Ask",
  description: "Answer and investigate without implementing changes.",
  intent: "answer",
  safety: {
    mutations: "deny",
    sandbox: "inherit-runtime",
    computerUse: "observe-only",
  },
  outputKind: "plain",
  supportedProviders: ["codex", "claudeAgent", "cursor", "opencode"],
  unsupportedProviderBehavior: "reject",
  providerBehaviors: [
    {
      providerId: "codex",
      collaborationMode: "default",
      developerInstructions: CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
    },
    {
      providerId: "claudeAgent",
      permissionMode: "session-default",
      promptPrefix: ASK_MODE_PROMPT_PREFIX,
      promptInputLabel: "User question:",
    },
    { providerId: "cursor", nativeMode: "ask", nativeModeFallback: "non-plan" },
    {
      providerId: "opencode",
      nativeModePrecedence: "user-first",
      promptPrefix: ASK_MODE_PROMPT_PREFIX,
      promptInputLabel: "User question:",
    },
  ],
} satisfies InteractionModeDescriptor;

const PLAN_INTERACTION_MODE = {
  id: "plan",
  ownerId: CORE_INTERACTION_MODE_OWNER_ID,
  version: 1,
  displayName: "Plan",
  description: "Explore and produce a proposed implementation plan without making changes.",
  intent: "propose",
  safety: {
    mutations: "deny",
    sandbox: "inherit-runtime",
    computerUse: "observe-only",
  },
  outputKind: "proposed-plan",
  supportedProviders: ["codex", "claudeAgent", "cursor", "opencode"],
  unsupportedProviderBehavior: "reject",
  providerBehaviors: [
    {
      providerId: "codex",
      collaborationMode: "plan",
      developerInstructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
    },
    { providerId: "claudeAgent", permissionMode: "plan" },
    { providerId: "cursor", nativeMode: "plan", nativeModeFallback: "unchanged" },
    { providerId: "opencode", nativeMode: "plan", nativeModePrecedence: "user-first" },
  ],
} satisfies InteractionModeDescriptor;

export const BUILT_IN_INTERACTION_MODE_REGISTRATIONS = [
  { descriptor: DEFAULT_INTERACTION_MODE },
  { descriptor: ASK_INTERACTION_MODE },
  { descriptor: PLAN_INTERACTION_MODE },
] satisfies ReadonlyArray<ExperimentalInteractionModeRegistration>;

export const BUILT_IN_INTERACTION_MODE_REGISTRY = createExperimentalInteractionModeRegistry(
  BUILT_IN_INTERACTION_MODE_REGISTRATIONS,
);
