import { afterEach, expect, it, vi } from "vite-plus/test";
import { openBrowserDatabase } from "./browserDatabase";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fixture() {
  const database = Object.assign(new EventTarget(), {
    objectStoreNames: { contains: () => false },
    createObjectStore: vi.fn(),
    close: vi.fn(),
  });
  const request = Object.assign(new EventTarget(), {
    result: database,
    transaction: { abort: vi.fn() },
  });
  const open = vi.fn(() => request);
  vi.stubGlobal("indexedDB", { open });
  return { database, request, open };
}

it.each([
  [
    "connections",
    "upcomputer:connection-runtime",
    5,
    ["catalog", "shell", "thread", "server-config", "vcs-refs"],
  ],
  ["proofKeys", "upcomputer:cloud-auth", 2, ["keys"]],
] as const)("opens only its own %s database", async (kind, name, version, stores) => {
  const { database, request, open } = fixture();
  const result = openBrowserDatabase(kind);
  request.dispatchEvent(new Event("upgradeneeded"));
  request.dispatchEvent(new Event("success"));
  expect(await result).toBe(database);
  expect(open.mock.calls).toEqual([[name, version]]);
  expect(database.createObjectStore.mock.calls).toEqual(stores.map((store) => [store]));
  database.dispatchEvent(new Event("versionchange"));
  expect(database.close).toHaveBeenCalledOnce();
});

it("closes a late handle after blocked open, without accessing another store", async () => {
  const { database, request, open } = fixture();
  const result = openBrowserDatabase("connections");
  const rejected = expect(result).rejects.toThrow("Close other UpComputer tabs");
  request.dispatchEvent(new Event("blocked"));
  await rejected;
  request.dispatchEvent(new Event("success"));
  expect(database.close).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
});
