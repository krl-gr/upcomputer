import type {
  ServerProvider,
  ServerProviderVersionAdvisory,
  ServerProviderCompatibilityAdvisory,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

export const PROVIDER_STATUS_STYLES = {
  // UpComputer: not reported yet, or its first check is still running.
  checking: {
    dot: "bg-muted-foreground/50",
  },
  disabled: {
    dot: "bg-muted-foreground/50",
  },
  error: {
    dot: "bg-destructive",
  },
  neutral: {
    dot: "bg-muted-foreground",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/** The server names a custom endpoint in English; other auth labels are product or plan names. */
export function providerAuthLabel(
  auth: Pick<ServerProvider["auth"], "label" | "type">,
  resolve: MessageResolver = m,
): string | undefined {
  if (auth.type === "customEndpoint") return resolve(msg("Custom API endpoint"));
  return auth.label ?? auth.type;
}

// Antigravity's local health check verifies installation, not Google sign-in.
// API-key and Agent Platform warnings still need attention.
function isAntigravitySignInUnchecked(provider: ServerProvider): boolean {
  return (
    provider.driver === "antigravity" &&
    provider.installed &&
    provider.status === "warning" &&
    provider.auth.status === "unknown" &&
    (provider.auth.type === undefined ||
      provider.auth.type === "oauth-personal" ||
      provider.auth.type === "oauth-business")
  );
}

/** Until a check reports, a provider is neither missing nor in need of attention. */
export function getProviderStatusKey(
  provider: ServerProvider | undefined,
  enabled: boolean = provider?.enabled ?? true,
): ProviderStatusKey {
  if (!enabled || provider?.enabled === false) return "disabled";
  // UpComputer: `statusPending` marks the placeholder published before the first check.
  if (provider === undefined || provider.statusPending === true) return "checking";
  if (isAntigravitySignInUnchecked(provider)) return "neutral";
  return provider.status;
}

export function getProviderSummary(
  provider: ServerProvider | undefined,
  resolve: MessageResolver = m,
) {
  if (!provider) {
    return {
      headline: resolve(msg("Checking provider status")),
      detail: resolve(
        msg("Waiting for the server to report installation and authentication details."),
      ),
    };
  }
  if (!provider.enabled || provider.status === "disabled") {
    return {
      headline: resolve(msg("Disabled", { $context: "provider status" })),
      detail:
        provider.message ??
        resolve(msg("This provider is installed but disabled for new sessions in Up.computer.")),
    };
  }
  // UpComputer: the placeholder before the first check says nothing about the provider yet.
  if (provider.statusPending === true) {
    return { headline: resolve(msg("Checking…")), detail: null };
  }
  if (!provider.installed) {
    return {
      headline: resolve(msg("Not found", { $context: "provider status, CLI is missing" })),
      detail: provider.message ?? resolve(msg("CLI not detected on PATH.")),
    };
  }
  if (provider.auth.status === "unauthenticated") {
    const authLabel = providerAuthLabel(provider.auth, resolve);
    return {
      headline: authLabel
        ? resolve(msg("Not authenticated · {method}", { method: authLabel }))
        : resolve(msg("Not authenticated")),
      detail: provider.message ?? null,
    };
  }
  if (isAntigravitySignInUnchecked(provider)) {
    return {
      headline: resolve(msg("Installed · Sign-in not checked")),
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: resolve(msg("Needs attention")),
      detail:
        provider.message ??
        resolve(msg("The provider is installed, but the server could not fully verify it.")),
    };
  }
  if (provider.status === "error") {
    return {
      headline: resolve(msg("Unavailable", { $context: "provider status" })),
      detail: provider.message ?? resolve(msg("The provider failed its startup checks.")),
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = providerAuthLabel(provider.auth, resolve);
    return {
      headline: authLabel
        ? resolve(msg("Authenticated · {method}", { method: authLabel }))
        : resolve(msg("Authenticated")),
      detail: provider.message ?? null,
    };
  }
  return {
    headline: resolve(msg("Available", { $context: "provider status" })),
    detail: provider.message ?? null,
  };
}

export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  const antigravity = /^agy_acp_server_(\d{4})(\d{2})(\d{2})_\d+(?:_(\w+))?$/.exec(version);
  if (antigravity) {
    const [, year, month, day, candidate] = antigravity;
    return `${year}-${month}-${day}${candidate ? ` ${candidate}` : ""}`;
  }
  return /^\d/.test(version) ? `v${version}` : version;
}

const COMPATIBILITY_TITLES = {
  graceful: msg("Limited support"),
  unsupported: msg("Unsupported version"),
  broken: msg("Known broken version"),
} as const;

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
  compatibility?: ServerProviderCompatibilityAdvisory | undefined,
  showCompatibility = true,
  resolve: MessageResolver = m,
): {
  readonly title: string;
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
  readonly targetVersion: string | null;
} | null {
  const latestIsIncompatible =
    compatibility?.latestVersionStatus === "broken" ||
    compatibility?.latestVersionStatus === "unsupported";
  if (
    showCompatibility &&
    compatibility &&
    (compatibility.status === "graceful" ||
      compatibility.status === "unsupported" ||
      compatibility.status === "broken")
  ) {
    const targetVersion = compatibility.recommendedVersion;
    const recommendation = getProviderVersionLabel(targetVersion) ?? compatibility.recommendedRange;
    // Latest package versions cannot be updated into recommendations requiring another package.
    const isAlreadyLatest = advisory?.status === "current";
    return {
      // UpComputer: an old version an update fixes is not alarming news, just a step.
      title:
        compatibility.status === "broken" && !latestIsIncompatible
          ? resolve(msg("Update required"))
          : resolve(COMPATIBILITY_TITLES[compatibility.status]),
      detail:
        compatibility.message ??
        (recommendation
          ? resolve(msg("Use {version} for full support.", { version: recommendation }))
          : resolve(msg("Update for full support."))),
      updateCommand:
        targetVersion || latestIsIncompatible || isAlreadyLatest
          ? null
          : (advisory?.updateCommand ?? null),
      emphasis: compatibility.status === "graceful" ? "normal" : "strong",
      targetVersion,
    };
  }
  if (
    !advisory ||
    advisory.status === "current" ||
    advisory.status === "unknown" ||
    latestIsIncompatible
  ) {
    return null;
  }

  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    title: resolve(msg("Update available")),
    detail:
      advisory.message ??
      (versionLabel
        ? resolve(msg("Update available: install {version}.", { version: versionLabel }))
        : resolve(msg("Update available: install the latest provider version."))),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
    targetVersion: null,
  };
}

const MANAGED_OPENCODE_BINARY = /[\\/]tools[\\/]opencode[\\/]([^\\/]+)[\\/]opencode(?:\.exe)?$/;

/** UpComputer: its server offers no update for this copy; app releases move the pin. */
export const isManagedOpenCodeBinaryPath = (binaryPath: string) =>
  MANAGED_OPENCODE_BINARY.test(binaryPath);

/**
 * UpComputer: the OpenCode the desktop app installs for a new user, at
 * `<home>/tools/opencode/<version>/opencode`, is a 1.x release the app pins and
 * tests, so OpenCode's "Limited support" note for 1.x is not shown for it.
 */
export function withoutManagedOpenCodeNote(
  provider: ServerProvider | undefined,
  binaryPath: string,
): ServerProvider | undefined {
  if (
    provider?.driver !== "opencode" ||
    provider.compatibilityAdvisory?.status !== "graceful" ||
    MANAGED_OPENCODE_BINARY.exec(binaryPath)?.[1] !== provider.version
  ) {
    return provider;
  }
  const { compatibilityAdvisory: _note, ...rest } = provider;
  return rest;
}

/** UpComputer: the oldest version with full support, from the recommendation or a `>=` range. */
function providerCompatibilityFloor(
  compatibility: Pick<
    ServerProviderCompatibilityAdvisory,
    "recommendedVersion" | "recommendedRange"
  >,
): string | null {
  if (compatibility.recommendedVersion) return compatibility.recommendedVersion;
  return /^>=\s*(\d[\w.+-]*)$/.exec(compatibility.recommendedRange?.trim() ?? "")?.[1] ?? null;
}

/**
 * UpComputer: the provider row's note for an old version: the version to reach and how,
 * rather than a bare "Incompatible". When updating cannot help, the plain status stays.
 */
export function providerCompatibilityRowHint(
  compatibility: ServerProviderCompatibilityAdvisory,
  canUpdateAll: boolean,
  resolve: MessageResolver = m,
): string {
  const latestIsIncompatible =
    compatibility.latestVersionStatus === "broken" ||
    compatibility.latestVersionStatus === "unsupported";
  const floor = providerCompatibilityFloor(compatibility);
  const plain =
    compatibility.status === "broken"
      ? resolve(msg("Incompatible"))
      : compatibility.status === "unsupported"
        ? resolve(msg("Unsupported"))
        : resolve(msg("Limited support"));
  if (latestIsIncompatible || floor === null) return plain;
  const version = getProviderVersionLabel(floor) ?? floor;
  const update = canUpdateAll
    ? resolve(msg("Update to {version} or newer with Update all", { version }))
    : resolve(msg("Update to {version} or newer", { version }));
  return compatibility.status === "graceful"
    ? resolve(msg("Limited support. {update}", { update }))
    : update;
}
