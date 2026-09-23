/** UpComputer owns these stores. Opening them never discovers or mutates T3 data. */
const DATABASES = {
  connections: {
    name: "upcomputer:connection-runtime",
    version: 5,
    stores: ["catalog", "shell", "thread", "server-config", "vcs-refs"],
  },
  proofKeys: { name: "upcomputer:cloud-auth", version: 2, stores: ["keys"] },
} as const;

export function openBrowserDatabase(kind: keyof typeof DATABASES): Promise<IDBDatabase> {
  const config = DATABASES[kind];
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(config.name, config.version);
    let cancelled = false;
    const fail = (message: string) => {
      cancelled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail("Opening browser storage timed out. Reload and retry."),
      10000,
    );
    request.addEventListener("blocked", () => fail("Close other UpComputer tabs, then retry."));
    request.addEventListener("error", () => fail("Could not open UpComputer browser storage."));
    request.addEventListener("upgradeneeded", () => {
      if (cancelled) {
        request.transaction?.abort();
        return;
      }
      for (const name of config.stores) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    });
    request.addEventListener("success", () => {
      clearTimeout(timer);
      const database = request.result;
      if (cancelled) {
        database.close();
        return;
      }
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    });
  });
}
