const REPO = "krl-gr/upcomputer";

export const RELEASE_VERSION = "0.0.40";
export const RELEASE_TAG = `core-v${RELEASE_VERSION}`;
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const RELEASE_URL = `${RELEASES_URL}/tag/${RELEASE_TAG}`;

export function releaseAssetUrl(suffix: string): string {
  // AppImages carry no version in the file name, so electron-updater can replace
  // the installed file in place (upstream pingdotgg/t3code#36306).
  const assetName = suffix.endsWith(".AppImage")
    ? `Up.computer-${suffix}`
    : `Up.computer-${RELEASE_VERSION}-${suffix}`;
  return `${RELEASES_URL}/download/${RELEASE_TAG}/${assetName}`;
}
