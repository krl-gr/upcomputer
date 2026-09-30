import type {
  AdvertisedEndpoint,
  DesktopBridge,
  DesktopWslState,
  ServerTailscaleServeStatus,
} from "@upcomputer/contracts";
import { UPCOMPUTER_RELEASE_CAPABILITIES } from "@upcomputer/shared/upcomputerReleasePolicy";

export function canOfferSshEnvironmentOnboarding(): boolean {
  return UPCOMPUTER_RELEASE_CAPABILITIES.sshRemoteServerBootstrap;
}

export function canConnectSavedEnvironment(targetTag: string): boolean {
  return targetTag !== "SshConnectionTarget" || canOfferSshEnvironmentOnboarding();
}

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

/**
 * A QR code encoding a loopback URL makes the scanning device dial itself, so
 * loopback endpoints stay copyable from the endpoint menu but are never
 * offered as QR targets.
 */
export function isQrShareableEndpoint(endpoint: AdvertisedEndpoint): boolean {
  return endpoint.status !== "unavailable" && endpoint.reachability !== "loopback";
}

/**
 * An https endpoint another device can open: the only kind that works away
 * from home over Tailscale and that a phone can install as an app, so sharing
 * prefers it.
 */
export function isHttpsShareableEndpoint(endpoint: AdvertisedEndpoint): boolean {
  if (!isQrShareableEndpoint(endpoint)) {
    return false;
  }
  try {
    return new URL(endpoint.httpBaseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export type QrEndpointOption = {
  /** Unique per endpoint instance (AdvertisedEndpoint.id); safe as a React key. */
  readonly id: string;
  /**
   * Stable per endpoint *type* (endpointDefaultPreferenceKey). Multiple
   * endpoints can share one, so it is only used to match the saved default.
   */
  readonly preferenceKey: string;
  /** False for endpoints that stay copyable but must never render as a QR. */
  readonly qrShareable: boolean;
  /** True for QR-shareable https endpoints (isHttpsShareableEndpoint). */
  readonly httpsShareable: boolean;
};

/**
 * Resolves which endpoint the share panel shows: the user's explicit pick,
 * else the first https endpoint, else the saved default endpoint, else the
 * first QR-shareable option (so the panel never opens on a loopback QR), else
 * the first option. A stale selectedId (endpoint disappeared) falls back
 * rather than blanking the panel.
 */
export function selectQrEndpointOption<T extends QrEndpointOption>(
  options: ReadonlyArray<T>,
  selectedId: string | null,
  defaultPreferenceKey: string | null,
): T | null {
  return (
    (selectedId !== null ? options.find((option) => option.id === selectedId) : undefined) ??
    options.find((option) => option.httpsShareable) ??
    (defaultPreferenceKey !== null
      ? options.find((option) => option.preferenceKey === defaultPreferenceKey)
      : undefined) ??
    options.find((option) => option.qrShareable) ??
    options[0] ??
    null
  );
}

/** What the Tailscale HTTPS row shows. */
export type TailscaleHttpsRowState =
  | { readonly kind: "not-running" }
  | { readonly kind: "cli-unreachable" }
  | { readonly kind: "off" }
  | { readonly kind: "pending" }
  | { readonly kind: "available"; readonly url: string }
  | { readonly kind: "approval-required"; readonly approvalUrl: string }
  | { readonly kind: "failed"; readonly message: string; readonly outputExcerpt?: string }
  /** Serve is configured, but the HTTPS address does not answer (certificates, MagicDNS). */
  | { readonly kind: "not-answering"; readonly url: string };

/**
 * Combines the saved intent (serveEnabled), the backend's last `tailscale
 * serve` outcome and the probed endpoint, so an enabled but failing setup
 * shows as such instead of as off.
 */
export function resolveTailscaleHttpsRowState(input: {
  readonly endpoint: AdvertisedEndpoint | null;
  readonly serveEnabled: boolean;
  readonly cliUnreachable: boolean;
  readonly serveStatus: ServerTailscaleServeStatus | null;
}): TailscaleHttpsRowState {
  const { endpoint, serveStatus } = input;
  const missingEndpointState: TailscaleHttpsRowState = input.cliUnreachable
    ? { kind: "cli-unreachable" }
    : { kind: "not-running" };
  if (!input.serveEnabled) {
    return endpoint ? { kind: "off" } : missingEndpointState;
  }
  if (serveStatus?.status === "approval-required") {
    return { kind: "approval-required", approvalUrl: serveStatus.approvalUrl };
  }
  if (serveStatus?.status === "failed") {
    return {
      kind: "failed",
      message: serveStatus.message,
      ...(serveStatus.outputExcerpt === undefined
        ? {}
        : { outputExcerpt: serveStatus.outputExcerpt }),
    };
  }
  if (endpoint?.status === "available") {
    return { kind: "available", url: endpoint.httpBaseUrl };
  }
  if (serveStatus?.status === "pending") {
    return { kind: "pending" };
  }
  return endpoint ? { kind: "not-answering", url: endpoint.httpBaseUrl } : missingEndpointState;
}

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  // Stage every preference before enabling. The desktop only relaunches for
  // mode/distro changes while WSL is active, so the final enable observes the
  // complete selection and is the only call that may relaunch.
  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}
