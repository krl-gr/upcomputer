import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type EnvironmentId,
  type ExecutionEnvironmentPlatformOs,
  type ProviderInstallState,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import { hasProviderSetup } from "../components/chat/ProviderStatusBanner";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { productSurface } from "../product/productFlags";
import type { ProviderInstanceEntry } from "../providerInstances";

/*
 * The `onboarding` surface's decisions. With `upstream` the first run is
 * exactly upstream's WelcomeWizard; with `upcomputer` it is V1's agent table
 * (`UpComputerOnboarding.tsx`) on top of upstream's provider logic.
 */

export type UpComputerOnboardingDriver =
  | "codex"
  | "claudeAgent"
  | "cursor"
  | "grok"
  | "opencode"
  | "antigravity";

export interface UpComputerOnboardingAgent {
  readonly driver: UpComputerOnboardingDriver;
  readonly name: string;
  readonly description: string;
  /**
   * `managed`: Up.computer downloads it (Codex with ChatGPT, Antigravity).
   * `terminal`: the official installer runs in a terminal. `none`: it ships
   * with Up.computer (Cursor's SDK).
   */
  readonly install: "managed" | "terminal" | "none";
  /** `in-app`: the provider's own sign-in flow; `terminal`: its CLI login. */
  readonly signIn: "in-app" | "terminal";
}

// V1's rows (core-v0.0.32 `providerDriverMeta.ts`), in its order.
export const UPCOMPUTER_ONBOARDING_AGENTS: ReadonlyArray<UpComputerOnboardingAgent> = [
  {
    driver: "codex",
    name: "Codex",
    description:
      "Great for computer-use tasks, with ChatGPT subscription access and strong review workflows.",
    install: "managed",
    signIn: "in-app",
  },
  {
    driver: "claudeAgent",
    name: "Claude",
    description:
      "Use your Claude subscription with powerful skills, hooks, MCP, and multi-agent workflows.",
    install: "terminal",
    signIn: "terminal",
  },
  {
    driver: "cursor",
    name: "Cursor",
    description: "Use your Cursor subscription and its broad selection of frontier coding models.",
    install: "none",
    signIn: "in-app",
  },
  {
    driver: "grok",
    name: "Grok",
    description: "Use your SuperGrok or X Premium+ subscription with Grok Build.",
    install: "terminal",
    signIn: "terminal",
  },
  {
    driver: "opencode",
    name: "OpenCode",
    description: "Model-agnostic access to 75+ providers, local models, and free options.",
    install: "terminal",
    signIn: "terminal",
  },
  {
    driver: "antigravity",
    name: "Antigravity",
    description:
      "Use your Google AI subscription with Gemini models through Google's official Antigravity agent.",
    install: "managed",
    signIn: "in-app",
  },
];

/**
 * Our screens set up agents on the server this window is paired with, so
 * they need one. Hosted web without a local server keeps upstream's wizard,
 * whose Connect step is how it gets a computer at all.
 */
export function showsUpComputerOnboarding(input: {
  readonly localAvailable: boolean;
  readonly environmentId: EnvironmentId | undefined;
}): boolean {
  return (
    productSurface("onboarding") === "upcomputer" &&
    input.localAvailable &&
    input.environmentId !== undefined
  );
}

/**
 * Upstream treats a Codex instance without `setupMode` as "existing CLI" but
 * still offers ChatGPT; only an explicit choice shows the CLI steps.
 */
export function isCodexExistingCliChosen(config: unknown): boolean {
  return (
    config !== null &&
    typeof config === "object" &&
    "setupMode" in config &&
    config.setupMode === "existing"
  );
}

/** How an agent installs right now: Codex follows its setup mode. */
function resolveAgentInstallKind(
  agent: UpComputerOnboardingAgent,
  codexExistingCli: boolean,
): UpComputerOnboardingAgent["install"] {
  return agent.driver === "codex" && codexExistingCli ? "terminal" : agent.install;
}

/** How an agent signs in right now: the Codex CLI logs in from a terminal. */
export function resolveAgentSignInKind(
  agent: UpComputerOnboardingAgent,
  codexExistingCli: boolean,
): UpComputerOnboardingAgent["signIn"] {
  return agent.driver === "codex" && codexExistingCli ? "terminal" : agent.signIn;
}

export type AgentInstallCell = "checking" | "installed" | "included" | "built-in" | "install";

export function resolveAgentInstallCell(input: {
  readonly agent: UpComputerOnboardingAgent;
  readonly provider: ServerProvider | undefined;
  readonly codexExistingCli: boolean;
}): AgentInstallCell {
  if (input.provider === undefined) return "checking";
  const kind = resolveAgentInstallKind(input.agent, input.codexExistingCli);
  if (kind === "none") return "built-in";
  const state = getOnboardingProviderState(input.provider);
  if (state === "checking") return "checking";
  if (input.provider.installed) return "installed";
  // Managed Codex downloads as part of "Connect", so it needs no step of its own.
  return input.agent.driver === "codex" && kind === "managed" ? "included" : "install";
}

export type AgentReadyCell = "ready" | "checking" | "connect" | "sign-in" | "install-first";

/**
 * A disabled agent (all but Codex and Claude start disabled) still offers
 * Connect: choosing to set it up turns it on.
 */
export function resolveAgentReadyCell(input: {
  readonly agent: UpComputerOnboardingAgent;
  readonly provider: ServerProvider | undefined;
  readonly codexExistingCli: boolean;
}): AgentReadyCell {
  if (input.provider === undefined) return "checking";
  const state = getOnboardingProviderState(input.provider);
  if (state === "ready") return "ready";
  if (state === "checking") return "checking";
  if (state === "disabled") return "connect";
  if (resolveAgentSignInKind(input.agent, input.codexExistingCli) === "in-app") return "connect";
  if (state === "install") return "install-first";
  return "sign-in";
}

export function countReadyOnboardingProviders(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): number {
  return (
    providers?.filter(
      (provider) => provider.enabled && getOnboardingProviderState(provider) === "ready",
    ).length ?? 0
  );
}

/*
 * Official installers for the CLIs upstream's wizard does not install. They
 * write to ~/.opencode/bin and ~/.grok/bin, where the server finds CLIs without
 * a restart, and need no Node.js. On Windows both come from npm.
 */
const CLI_INSTALL_COMMANDS = {
  grok: {
    posix: "curl -fsSL https://x.ai/cli/install.sh | bash",
    windows: "npm install -g @xai-official/grok",
  },
  opencode: {
    posix: "curl -fsSL https://opencode.ai/install | bash",
    windows: "npm install -g opencode-ai",
  },
} as const;

const CLI_LOGIN_COMMANDS = { grok: "login", opencode: "auth login" } as const;
const SAFE_BINARY_PATH = /^[A-Za-z0-9_./~-]+$/;

export function resolveCliInstallCommand(
  driver: keyof typeof CLI_INSTALL_COMMANDS,
  platform: ExecutionEnvironmentPlatformOs,
): string {
  return platform === "windows"
    ? CLI_INSTALL_COMMANDS[driver].windows
    : CLI_INSTALL_COMMANDS[driver].posix;
}

/** What the install step says before it runs: npm needs Node.js, which a new computer lacks. */
export function resolveCliInstallNote(platform: ExecutionEnvironmentPlatformOs): string {
  return platform === "windows"
    ? "Installs with npm in a terminal here. Needs Node.js from nodejs.org."
    : "Runs the official installer in a terminal here.";
}

/** The CLI's own login, through a configured binary path when it needs no quoting. */
export function resolveCliLoginCommand(
  driver: keyof typeof CLI_LOGIN_COMMANDS,
  instanceConfig: unknown,
): string {
  const configured =
    instanceConfig !== null &&
    typeof instanceConfig === "object" &&
    "binaryPath" in instanceConfig &&
    typeof instanceConfig.binaryPath === "string"
      ? instanceConfig.binaryPath.trim()
      : "";
  const binary = configured !== "" && SAFE_BINARY_PATH.test(configured) ? configured : driver;
  return `${binary} ${CLI_LOGIN_COMMANDS[driver]}`;
}

const SETUP_TARGET_DRIVERS: ReadonlySet<string> = new Set(["codex", "claudeAgent"]);

/**
 * Where the composer's "Open provider settings" goes when no agent works.
 * Upstream picks the first provider with in-app setup, which on a clean Mac
 * is Cursor: nobody installed it. An agent the user already installed comes
 * first, then Codex and Claude, then any with in-app setup.
 */
export function composerProviderSetupInstanceId(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceId | undefined {
  if (productSurface("onboarding") !== "upcomputer") {
    return entries.find((entry) => hasProviderSetup(entry.snapshot))?.instanceId;
  }
  return resolveProviderSetupInstanceId(entries);
}

function resolveProviderSetupInstanceId(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceId | undefined {
  const enabled = entries.filter((entry) => entry.enabled);
  const candidates = enabled.length > 0 ? enabled : entries;
  const rank = (entry: ProviderInstanceEntry) =>
    (entry.installed ? 0 : 4) +
    (SETUP_TARGET_DRIVERS.has(entry.driverKind) ? 0 : 2) +
    (hasProviderSetup(entry.snapshot) ? 0 : 1);
  let best: ProviderInstanceEntry | undefined;
  for (const entry of candidates) {
    if (best === undefined || rank(entry) < rank(best)) best = entry;
  }
  return best?.instanceId;
}

/*
 * A new user skips the agent table: the app installs OpenCode, whose free Zen
 * models answer without an account, and the composer shows that setup until
 * the first agent works.
 */
export const FIRST_RUN_AGENT_INSTANCE_ID = defaultInstanceIdForDriver(
  ProviderDriverKind.make("opencode"),
);

/**
 * OpenCode turns selectable as soon as settings turn it on, but lists no models
 * until its first check answers, and for a moment the stream still holds the
 * snapshot from while it was off. The composer keeps the setup state until
 * then, so its model picker never flashes "Choose model" in between.
 */
export function isFirstRunAgentChecking(entry: ProviderInstanceEntry | undefined): boolean {
  if (entry?.instanceId !== FIRST_RUN_AGENT_INSTANCE_ID) return false;
  const { snapshot } = entry;
  return snapshot.statusPending === true || !snapshot.enabled || snapshot.status === "disabled";
}

/** How long a new user's setup waits for the agents already on the Mac to answer their first check. */
export const FIRST_RUN_AGENT_CHECK_WAIT_MS = 10_000;

/**
 * Whether a new user's window installs OpenCode. A user whose own agent works
 * needs no download, so this waits for each turned-on agent's first check, but
 * a check that does not answer within `FIRST_RUN_AGENT_CHECK_WAIT_MS` does not
 * hold setup back.
 */
export function resolveFirstRunAgentStart(input: {
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
  readonly waitOver: boolean;
}): "wait" | "install" | "skip" {
  const others =
    input.providers?.filter(
      (provider) => provider.enabled && provider.instanceId !== FIRST_RUN_AGENT_INSTANCE_ID,
    ) ?? [];
  if (others.some((provider) => getOnboardingProviderState(provider) === "ready")) return "skip";
  if (input.waitOver) return "install";
  if (!input.providers || others.some((provider) => provider.statusPending === true)) {
    return "wait";
  }
  return "install";
}

export type FirstRunAgentStart = "install" | "skip";

/**
 * The starter decides once per window session. After `skip`, or once
 * onboarding is complete, an agent of the user's that later stops working
 * (turned off, signed out, a failed recheck) starts no download.
 */
export function latchFirstRunAgentStart(input: {
  readonly latched: FirstRunAgentStart | null;
  readonly completed: boolean;
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
  readonly waitOver: boolean;
}): FirstRunAgentStart | null {
  if (input.latched !== null) return input.latched;
  if (input.completed) return "skip";
  const next = resolveFirstRunAgentStart(input);
  return next === "wait" ? null : next;
}

export type FirstRunAgentStatus =
  | { readonly kind: "preparing"; readonly progress: number | null }
  | { readonly kind: "failed"; readonly message: string };

const FIRST_RUN_SETUP_FAILED = "Could not set up your agent.";

/**
 * How long a new user may stay on the first screen with a working agent and
 * no turn before `onboarding.first_screen_idle` reports it. Reading the
 * screen and typing a first prompt fits well inside it, while a session that
 * ends without a turn is usually still open by then.
 */
export const FIRST_SCREEN_IDLE_THRESHOLD_MS = 3 * 60_000;

/** How long setup still shows once the install succeeds, while the server turns OpenCode on. */
export const FIRST_RUN_AGENT_ACTIVATION_WAIT_MS = 10_000;

/** The activation wait the starter is running, or has finished, for one succeeded install. */
export interface FirstRunAgentActivation {
  readonly operationId: string;
  readonly active: boolean;
}

/**
 * The starter records the wait in an effect, a render after the install
 * succeeds. Until then a running starter counts the wait as begun, or the
 * composer would offer "Open provider settings" for that one frame.
 */
export function isFirstRunAgentActivating(input: {
  readonly succeededOperationId: string | null;
  readonly starterRunning: boolean;
  readonly activation: FirstRunAgentActivation | null;
}): boolean {
  if (input.succeededOperationId === null) return false;
  if (input.activation?.operationId === input.succeededOperationId) {
    return input.activation.active;
  }
  return input.starterRunning;
}

export function resolveFirstRunAgentStatus(input: {
  readonly requested: boolean;
  readonly startError: string | null;
  readonly install: ProviderInstallState | null;
  readonly provider: ServerProvider | undefined;
  /** Within `FIRST_RUN_AGENT_ACTIVATION_WAIT_MS` of this window seeing the install succeed. */
  readonly activating: boolean;
}): FirstRunAgentStatus | null {
  const { install } = input;
  if (input.startError !== null && (install === null || install.phase === "idle")) {
    return { kind: "failed", message: input.startError };
  }
  switch (install?.phase) {
    case "downloading":
      return {
        kind: "preparing",
        progress:
          install.totalBytes !== null && install.totalBytes > 0
            ? Math.min(1, install.downloadedBytes / install.totalBytes)
            : null,
      };
    case "extracting":
    case "verifying":
      return { kind: "preparing", progress: 1 };
    case "failed":
    case "cancelled":
      return { kind: "failed", message: install.message ?? FIRST_RUN_SETUP_FAILED };
    case "succeeded": {
      const state = getOnboardingProviderState(input.provider);
      if (state === "ready") return null;
      if (state === "attention" || state === "install" || state === "signIn") {
        return { kind: "failed", message: input.provider?.message ?? FIRST_RUN_SETUP_FAILED };
      }
      if (state === "checking" && input.provider?.enabled === true) {
        return { kind: "preparing", progress: null };
      }
      // Until the turned-on instance reports, the stream still holds the disabled
      // one. Past that wait, OpenCode is off by the user's choice.
      return input.activating ? { kind: "preparing", progress: null } : null;
    }
    default:
      return input.requested ? { kind: "preparing", progress: null } : null;
  }
}
