const REPO = "krl-gr/upcomputer";

export const RELEASE_VERSION = "0.0.40";
export const RELEASE_TAG = `core-v${RELEASE_VERSION}`;
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const RELEASE_URL = `${RELEASES_URL}/tag/${RELEASE_TAG}`;

export function releaseAssetUrl(suffix: string): string {
  // 0.0.40 published its AppImage without the version in the file name.
  const assetName =
    suffix === "x86_64.AppImage"
      ? `Up.computer-${suffix}`
      : `Up.computer-${RELEASE_VERSION}-${suffix}`;
  return `${RELEASES_URL}/download/${RELEASE_TAG}/${assetName}`;
}
