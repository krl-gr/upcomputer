const REPO = "krl-gr/upcomputer";

export const RELEASE_VERSION = "0.0.31";
export const RELEASE_TAG = `v${RELEASE_VERSION}`;
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const RELEASE_URL = `${RELEASES_URL}/tag/${RELEASE_TAG}`;

export function releaseAssetUrl(suffix: string): string {
  const assetName = `Up.computer-${RELEASE_VERSION}-${suffix}`;
  return `${RELEASES_URL}/download/${RELEASE_TAG}/${assetName}`;
}
