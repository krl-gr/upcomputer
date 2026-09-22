import { describe, expect, it } from "vite-plus/test";
import { LEGACY_UI_STORAGE_KEYS, migratingUiStorage } from "./legacyUiStorage";

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
  };
}

describe("legacy UI storage migration", () => {
  it.each(Object.entries(LEGACY_UI_STORAGE_KEYS))(
    "migrates %s without rewriting its payload",
    (key, legacy) => {
      const raw = memoryStorage();
      const payload = '{"version":1,"draft":"unsent fixture","nested":{"value":false}}';
      raw.setItem(legacy, payload);
      const storage = migratingUiStorage(raw);
      expect(storage.getItem(key)).toBe(payload);
      expect(raw.getItem(key)).toBe(payload);
      expect(raw.getItem(legacy)).toBeNull();
      expect(storage.getItem(key)).toBe(payload);
      expect(migratingUiStorage(raw)).toBe(storage);
    },
  );

  it.each(["", "new value"])("never overwrites an existing new value: %j", (value) => {
    const raw = memoryStorage();
    raw.setItem("t3code:theme", "dark");
    raw.setItem("upcomputer:theme", value);
    expect(migratingUiStorage(raw).getItem("upcomputer:theme")).toBe(value);
  });

  it("keeps the fallback readable if migration cannot write (quota or denied access)", () => {
    const raw = memoryStorage();
    raw.setItem("t3code:composer-drafts:v1", "unsent fixture");
    const write = raw.setItem;
    raw.setItem = () => {
      throw new Error("quota");
    };
    const storage = migratingUiStorage(raw);
    expect(storage.getItem("upcomputer:composer-drafts:v1")).toBe("unsent fixture");
    expect(raw.getItem("t3code:composer-drafts:v1")).toBe("unsent fixture");
    raw.setItem = write;
    expect(storage.getItem("upcomputer:composer-drafts:v1")).toBe("unsent fixture");
    expect(raw.getItem("t3code:composer-drafts:v1")).toBeNull();
  });

  it("does not resurrect deleted state even when both names existed", () => {
    const raw = memoryStorage();
    raw.setItem("t3code:composer-drafts:v1", "old");
    raw.setItem("upcomputer:composer-drafts:v1", "new");
    const storage = migratingUiStorage(raw);
    storage.removeItem("upcomputer:composer-drafts:v1");
    expect(storage.getItem("upcomputer:composer-drafts:v1")).toBeNull();
    expect(raw.length).toBe(0);
  });

  it("preserves current state when removing the legacy fallback fails", () => {
    const raw = memoryStorage();
    raw.setItem("t3code:theme", "dark");
    raw.setItem("upcomputer:theme", "light");
    const remove = raw.removeItem;
    raw.removeItem = (key) => {
      if (key === "t3code:theme") throw new Error("denied");
      remove(key);
    };
    const storage = migratingUiStorage(raw);
    expect(() => storage.removeItem("upcomputer:theme")).toThrow("denied");
    expect(storage.getItem("upcomputer:theme")).toBe("light");
  });

  it("writes only the new key, and never migrates unknown or auth names", () => {
    const raw = memoryStorage();
    raw.setItem("t3code:theme", "dark");
    raw.setItem("t3code-connect-cli-auth-state", "opaque-fixture");
    const storage = migratingUiStorage(raw);
    storage.setItem("upcomputer:theme", "light");
    expect(raw.getItem("t3code:theme")).toBeNull();
    expect(storage.getItem("upcomputer-connect-cli-auth-state")).toBeNull();
    expect(raw.getItem("t3code-connect-cli-auth-state")).toBe("opaque-fixture");
  });
});
