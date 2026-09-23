/**
 * Temporary native-encryption bridge, not a product/display name.
 * Electron captures this name before ready for OS encryption. Renaming only
 * package.json otherwise selects a different macOS Safe Storage key, even when
 * DesktopAppIdentity later restores the same visible application name.
 *
 * Retire only after a verified native migration covers the connection catalog,
 * Clerk and Chromium encrypted state AND retains the old context for restore.
 * Never fall back by deleting a catalog or replacing an unreadable profile.
 */
export function configureLegacyEncryptionIdentity(app: {
  readonly isPackaged: boolean;
  readonly getName: () => string;
  readonly isReady: () => boolean;
  readonly setName: (name: string) => void;
}): void {
  const legacyName = app.isPackaged
    ? "t3code"
    : app.getName() === "@upcomputer/desktop"
      ? "@t3tools/desktop"
      : undefined;
  if (legacyName === undefined) return;
  if (app.isReady()) {
    throw new Error("Native encryption identity must be configured before Electron readiness.");
  }
  app.setName(legacyName);
}
