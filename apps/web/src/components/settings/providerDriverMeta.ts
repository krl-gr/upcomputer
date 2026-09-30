import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  GrokSettings,
  OpenCodeSettings,
  ProviderDriverKind,
} from "@upcomputer/contracts";
import type * as Schema from "effect/Schema";
import type { ComponentType } from "react";
import {
  listExperimentalWebProviderDrivers,
  type ExperimentalWebProductComposition,
} from "../../product/WebComposition";
import type { ExperimentalWebProviderDriverDetailsProps } from "../../product/WebFeature";
import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  type Icon,
  OpenAI,
  OpenCodeIcon,
} from "../Icons";
import { ProviderSetupOnboarding, ProviderSetupSection } from "./ProviderSetupSection";

type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

/**
 * Browser-safe provider definition. This is deliberately shaped like the
 * future provider package client export: the core web app gets a schema with
 * field annotations plus provider-level presentation metadata, then renders
 * settings generically.
 */
export interface ProviderClientDefinition {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: Icon;
  readonly settingsSchema: ProviderSettingsSchema;
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
  readonly onboardingDescription?: string;
  /**
   * CLI sign-in help for drivers that have no in-app connection flow. These
   * agents authenticate through their own CLI, so onboarding can only tell the
   * user what to run — `command` is shown verbatim in a copyable block and
   * `instructions` is one or two sentences of context.
   */
  readonly signIn?: {
    readonly command: string;
    readonly instructions: string;
  };
  readonly onboardingOrder?: number;
  readonly settingsOrder?: number;
  readonly defaultSettingsExpanded?: boolean;
  readonly connectionDetails?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
  readonly onboardingDetails?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
  readonly advancedDetails?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
  readonly details?: ComponentType<ExperimentalWebProviderDriverDetailsProps>;
}

export const PROVIDER_CLIENT_DEFINITIONS: readonly ProviderClientDefinition[] = [
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    icon: OpenAI,
    settingsSchema: CodexSettings,
    onboardingDescription:
      "Great for computer-use tasks, with ChatGPT subscription access and strong review workflows.",
    signIn: {
      command: "codex login",
      instructions:
        "Run this in a terminal on the machine running UpComputer, then finish signing in with your ChatGPT account in the browser it opens.",
    },
    onboardingOrder: 10,
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    icon: ClaudeAI,
    settingsSchema: ClaudeSettings,
    onboardingDescription:
      "Use your Claude subscription with powerful skills, hooks, MCP, and multi-agent workflows.",
    signIn: {
      command: "claude",
      instructions:
        "Run this in a terminal on the machine running UpComputer, then type `/login` inside Claude Code and follow the browser prompt.",
    },
    onboardingOrder: 20,
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    icon: CursorIcon,
    badgeLabel: "Early Access",
    settingsSchema: CursorSettings,
    onboardingDescription:
      "Use your Cursor subscription and its broad selection of frontier coding models.",
    signIn: {
      command: "agent login",
      instructions:
        "Run this in a terminal on the machine running UpComputer and complete sign-in with your Cursor account in the browser.",
    },
    onboardingOrder: 30,
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    icon: GrokIcon,
    badgeLabel: "Early Access",
    settingsSchema: GrokSettings,
    onboardingDescription: "Use your SuperGrok or X Premium+ subscription with Grok Build.",
    signIn: {
      command: "grok login",
      instructions:
        "Run this in a terminal on the machine running UpComputer and sign in with the X account that holds your SuperGrok or Premium+ subscription.",
    },
    onboardingOrder: 40,
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    icon: OpenCodeIcon,
    settingsSchema: OpenCodeSettings,
    onboardingDescription:
      "Model-agnostic access to 75+ providers, local models, and free options.",
    signIn: {
      command: "opencode auth login",
      instructions:
        "Run this in a terminal on the machine running UpComputer and pick the model provider you want to authenticate.",
    },
    onboardingOrder: 50,
  },
  {
    value: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    icon: AntigravityIcon,
    badgeLabel: "Early Access",
    settingsSchema: AntigravitySettings,
    onboardingDescription:
      "Use your Google AI subscription with Gemini models through Google's official Antigravity agent.",
    // No CLI sign-in: the runtime installs and signs in from inside the app.
    onboardingOrder: 60,
    onboardingDetails: ProviderSetupOnboarding,
    details: ProviderSetupSection,
  },
];

export const PROVIDER_CLIENT_DEFINITION_BY_VALUE: Partial<
  Record<ProviderDriverKind, ProviderClientDefinition>
> = Object.fromEntries(
  PROVIDER_CLIENT_DEFINITIONS.map((definition) => [definition.value, definition]),
);

export const DRIVER_OPTIONS = PROVIDER_CLIENT_DEFINITIONS;
export const DRIVER_OPTION_BY_VALUE = PROVIDER_CLIENT_DEFINITION_BY_VALUE;
export type DriverOption = ProviderClientDefinition;

export function sortProviderClientDefinitionsForOnboarding(
  definitions: ReadonlyArray<ProviderClientDefinition>,
): ReadonlyArray<ProviderClientDefinition> {
  return definitions.toSorted(
    (left, right) =>
      (left.onboardingOrder ?? 1_000) - (right.onboardingOrder ?? 1_000) ||
      left.label.localeCompare(right.label),
  );
}

export function getProviderClientDefinitions(
  composition: ExperimentalWebProductComposition,
): ReadonlyArray<ProviderClientDefinition> {
  return [
    ...PROVIDER_CLIENT_DEFINITIONS,
    ...listExperimentalWebProviderDrivers(composition).map(({ provider }) => ({
      value: provider.driverKind,
      label: provider.label,
      icon: provider.icon,
      settingsSchema: provider.settingsSchema,
      ...(provider.badgeLabel === undefined ? {} : { badgeLabel: provider.badgeLabel }),
      ...(provider.onboardingDescription === undefined
        ? {}
        : { onboardingDescription: provider.onboardingDescription }),
      ...(provider.onboardingOrder === undefined
        ? {}
        : { onboardingOrder: provider.onboardingOrder }),
      ...(provider.settingsOrder === undefined ? {} : { settingsOrder: provider.settingsOrder }),
      ...(provider.defaultSettingsExpanded === undefined
        ? {}
        : { defaultSettingsExpanded: provider.defaultSettingsExpanded }),
      ...(provider.connectionDetails === undefined
        ? {}
        : { connectionDetails: provider.connectionDetails }),
      ...(provider.onboardingDetails === undefined
        ? {}
        : { onboardingDetails: provider.onboardingDetails }),
      ...(provider.advancedDetails === undefined
        ? {}
        : { advancedDetails: provider.advancedDetails }),
      ...(provider.details === undefined ? {} : { details: provider.details }),
    })),
  ];
}

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(
  driver: ProviderDriverKind | undefined,
  composition?: ExperimentalWebProductComposition,
): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return composition === undefined
    ? PROVIDER_CLIENT_DEFINITION_BY_VALUE[driver]
    : getProviderClientDefinitions(composition).find((definition) => definition.value === driver);
}
