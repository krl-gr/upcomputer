/** One-way browser-store migration. Old data is retained for recovery, not used as
 * a second live store. Do not export private keys: IndexedDB structured-clones them.
 * Remove this module only after the supported upgrade window closes.
 */
const MIGRATIONS = {
  connections: {
    current: "upcomputer:connection-runtime",
    legacy: "t3code:connection-runtime",
    legacyVersion: 4,
    version: 5,
    stores: ["catalog", "shell", "thread", "server-config", "vcs-refs"],
    copy: ["catalog"], // The other stores are disposable server-derived caches.
  },
  proofKeys: {
    current: "upcomputer:cloud-auth",
    legacy: "t3code:cloud-auth",
    legacyVersion: 1,
    version: 2,
    stores: ["keys"],
    copy: ["keys"],
  },
} as const;
const META = "upcomputer-migration-v1";
const DONE = "complete";
const RETIRED = "destination";
type Migration = (typeof MIGRATIONS)[keyof typeof MIGRATIONS];
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(new Error("Browser storage migration did not commit. Original data was retained.")),
    );
    transaction.addEventListener("error", () => {}); // onabort is authoritative, including quota failures.
  });
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(new Error("Could not read browser migration state.")),
    );
  });
}
function open(
  name: string,
  version?: number,
  upgrade?: (database: IDBDatabase, transaction: IDBTransaction) => void,
): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let absent = false;
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    const timer = setTimeout(() => {
      cancelled = true;
      reject(new Error("Browser storage migration timed out. Close other app tabs and retry."));
    }, 10000);
    request.addEventListener("blocked", () => {
      cancelled = true;
      clearTimeout(timer);
      reject(new Error("Close other app tabs before migrating browser storage, then reload."));
    });
    request.addEventListener("upgradeneeded", (event) => {
      if (cancelled) {
        request.transaction!.abort();
        return;
      }
      if (version === undefined && event.oldVersion === 0) {
        absent = true;
        request.transaction!.abort(); // Do not create an empty legacy database.
        return;
      }
      try {
        upgrade?.(request.result, request.transaction!);
      } catch {
        request.transaction!.abort();
      }
    });
    request.addEventListener("error", () => {
      clearTimeout(timer);
      if (absent) resolve(null);
      else
        reject(
          new Error("Could not open browser storage for migration. Original data was retained."),
        );
    });
    request.addEventListener("success", () => {
      clearTimeout(timer);
      if (cancelled) {
        request.result.close();
        return;
      }
      request.result.addEventListener("versionchange", () => request.result.close());
      resolve(request.result);
    });
  });
}
async function retireLegacy(config: Migration): Promise<IDBDatabase | null> {
  const old = await open(config.legacy);
  if (!old) return null;
  try {
    if (old.objectStoreNames.contains(META)) {
      const destination = await requestValue(old.transaction(META).objectStore(META).get(RETIRED));
      if (destination !== config.current)
        throw new Error("Conflicting browser migration destination. No data was overwritten.");
      return old;
    }
    if (old.version > config.legacyVersion)
      throw new Error(
        "Unsupported legacy browser database version. Update UpComputer before migrating.",
      );
  } catch (error) {
    old.close();
    throw error;
  }
  const version = old.version + 1;
  old.close();
  // The version-change barrier waits for all old handles to close. Old clients
  // pinned to the previous version subsequently fail instead of writing stale data.
  return open(config.legacy, version, (database, transaction) => {
    database.createObjectStore(META);
    transaction.objectStore(META).put(config.current, RETIRED);
  });
}
async function migrate(config: Migration): Promise<IDBDatabase> {
  const database = await open(config.current, config.version, (db) => {
    for (const store of [...config.stores, META]) {
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    }
  });
  if (!database) throw new Error("Could not initialize browser storage.");
  let legacy: IDBDatabase | null = null;
  try {
    const completed = await requestValue(database.transaction(META).objectStore(META).get(DONE));
    if (completed === true) return database;
    if (completed !== undefined)
      throw new Error("Invalid browser migration marker. No data was overwritten.");
    const inspect = database.transaction([...config.stores], "readonly");
    const counts = await Promise.all(
      config.stores.map((store) => requestValue(inspect.objectStore(store).count())),
    );
    if (counts.some((count) => count !== 0)) {
      throw new Error(
        "Both browser stores contain independent state. Resolve the migration conflict before continuing; no data was overwritten.",
      );
    }
    legacy = await retireLegacy(config);
    const records: Array<{
      store: string;
      key: IDBValidKey;
      value: unknown;
    }> = [];
    if (legacy) {
      const stores = config.copy.filter((store) => legacy!.objectStoreNames.contains(store));
      if (stores.length) {
        const read = legacy.transaction(stores, "readonly");
        const finished = transactionDone(read);
        for (const store of stores) {
          const cursor = read.objectStore(store).openCursor();
          cursor.addEventListener("success", () => {
            if (!cursor.result) return;
            records.push({ store, key: cursor.result.key, value: cursor.result.value });
            cursor.result.continue();
          });
        }
        await finished;
      }
    }
    // Never merge unrelated existing credentials/catalogs. All records and the
    // completion marker commit together, so retry cannot resurrect a logout.
    const write = database.transaction([...config.stores, META], "readwrite");
    const finished = transactionDone(write);
    try {
      for (const store of config.stores) {
        const count = write.objectStore(store).count();
        count.addEventListener("success", () => {
          if (count.result !== 0) write.abort();
        });
      }
      for (const record of records) write.objectStore(record.store).put(record.value, record.key);
      write.objectStore(META).put(true, DONE);
    } catch {
      write.abort();
      await finished.catch(() => {});
      throw new Error("Could not copy browser storage. Original data was retained.");
    }
    await finished;
    return database;
  } catch (error) {
    database.close();
    throw error;
  } finally {
    legacy?.close();
  }
}
export async function openMigratedBrowserDatabase(
  kind: keyof typeof MIGRATIONS,
): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined" || typeof navigator === "undefined" || !navigator.locks) {
    throw new Error(
      "Browser storage migration requires IndexedDB and Web Locks in a secure context.",
    );
  }
  return navigator.locks.request(`upcomputer:migrate:${kind}:v1`, () => migrate(MIGRATIONS[kind]));
}
