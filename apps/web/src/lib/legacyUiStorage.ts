// Compatibility is deliberately limited to non-auth UI state. IndexedDB keys,
// connection registrations and OAuth/DPoP state require their own migration.
export const LEGACY_UI_STORAGE_KEYS: Readonly<Record<string, string>> = {
  "upcomputer:client-settings:v1": "t3code:client-settings:v1",
  "upcomputer:composer-drafts:v1": "t3code:composer-drafts:v1",
  "upcomputer:chat-workspace:v1": "t3code:chat-workspace:v1",
  "upcomputer:diff-panel-state:v1": "t3code:diff-panel-state:v1",
  "upcomputer:right-panel-state:v2": "t3code:right-panel-state:v2",
  "upcomputer:terminal-state:v1": "t3code:terminal-state:v1",
  "upcomputer:ui-state:v1": "t3code:ui-state:v1",
  "upcomputer:theme": "t3code:theme",
  "upcomputer:last-editor": "t3code:last-editor",
  "upcomputer:last-invoked-script-by-project": "t3code:last-invoked-script-by-project",
  "upcomputer:preview-panel-width": "t3code:preview-panel-width",
  "upcomputer:last-enabled-project-grouping-mode": "t3code:last-enabled-project-grouping-mode",
  "upcomputer.fileExplorerOpen": "t3code.fileExplorerOpen",
  "upcomputer:provider-update-dismissals:v1": "t3code:provider-update-dismissals:v1",
  "upcomputer:version-mismatch-dismissals:v1": "t3code:version-mismatch-dismissals:v1",
  "upcomputer:connect-onboarding-opt-out:v1": "t3code:connect-onboarding-opt-out:v1",
};

const wrappers = new WeakMap<Storage, Storage>();

/** Copy before removing a legacy value. New state always wins, even if empty.
 * A quota failure must leave the original readable; migration can retry later.
 * Callers still own decoding, so this never rewrites drafts or schema versions.
 */
export function migratingUiStorage(storage: Storage): Storage {
  const previous = wrappers.get(storage);
  if (previous) return previous;
  const wrapped: Storage = {
    get length() {
      return storage.length;
    },
    key: (index) => storage.key(index),
    clear: () => storage.clear(),
    getItem: (key) => {
      const current = storage.getItem(key);
      const legacy = LEGACY_UI_STORAGE_KEYS[key];
      if (current !== null || !legacy) return current;
      const value = storage.getItem(legacy);
      if (value !== null) {
        try {
          storage.setItem(key, value);
          storage.removeItem(legacy);
        } catch {
          // Never log storage contents or drop the readable legacy value.
        }
      }
      return value;
    },
    setItem: (key, value) => {
      storage.setItem(key, value);
      const legacy = LEGACY_UI_STORAGE_KEYS[key];
      if (legacy) {
        try {
          storage.removeItem(legacy);
        } catch {
          /* The new value is already durable. */
        }
      }
    },
    removeItem: (key) => {
      // Remove the fallback first: failure must not resurrect a deleted draft.
      const legacy = LEGACY_UI_STORAGE_KEYS[key];
      if (legacy) storage.removeItem(legacy);
      storage.removeItem(key);
    },
  };
  wrappers.set(storage, wrapped);
  return wrapped;
}
