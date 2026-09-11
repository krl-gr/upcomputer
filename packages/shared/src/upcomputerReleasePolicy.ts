export const UPCOMPUTER_REMOTE_SERVER_RELEASE_NOTICE =
  "Official remote server installation and updates are not available in this release. Existing environments remain saved and can be disconnected or removed.";

/**
 * Temporary release contract for the official Up.computer build.
 *
 * The public npm package named `t3` is the upstream T3 Code package, not an
 * Up.computer distribution. These capabilities must stay off until
 * task-a802d2dd-7261-4937-b896-5a450526e42b chooses an official server/CLI
 * identity and delivery mechanism.
 */
export const UPCOMPUTER_RELEASE_CAPABILITIES = Object.freeze({
  bundledDesktopBackend: true,
  localProviders: true,
  t3ConnectToBundledDesktop: true,
  npmRemoteServerDistribution: false,
  sshRemoteServerBootstrap: false,
  remoteServerSelfUpdate: false,
  backgroundServiceSetup: false,
});

export function canOfferRemoteServerSelfUpdate(
  capability: "boot-service" | "desktop-managed" | "respawn" | null,
): boolean {
  return capability === "desktop-managed" || UPCOMPUTER_RELEASE_CAPABILITIES.remoteServerSelfUpdate;
}
