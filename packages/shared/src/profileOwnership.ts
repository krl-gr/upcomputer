// @effect-diagnostics nodeBuiltinImport:off - Native pre-runtime ownership gate, deliberately independent of application databases.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

export class ProfileOwnershipError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Profile ownership check failed (${code}). No application profile may be opened.`);
    this.name = "ProfileOwnershipError";
    this.code = code;
  }
}
function fail(code: string): never {
  throw new ProfileOwnershipError(code);
}

/** This is an OS-backed cooperative gate, NOT a complete migration lease.
 * Old binaries, unmanaged children and external Git processes do not participate.
 * Maintenance must separately exclude those writers; no PID fallback is provided.
 */
export interface ProfileOwnershipLease {
  readonly mode: "application" | "maintenance";
  readonly assertHeld: () => void;
  readonly release: () => void;
}
export function profileOwnershipDirectory(home: string): string {
  return NodePath.join(home, ".upcomputer-migrations", "ownership-v1");
}
function safeDirectory(directory: string): void {
  const stat = NodeFS.lstatSync(directory);
  if (!stat.isDirectory()) fail("unsafe-directory");
  if (
    typeof process.getuid === "function" &&
    (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0)
  )
    fail("unsafe-directory");
}
function safeFile(file: string): NodeFS.BigIntStats {
  const stat = NodeFS.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) fail("unsafe-file");
  if (
    typeof process.getuid === "function" &&
    (stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o022n) !== 0n)
  )
    fail("unsafe-file");
  return stat;
}
function classify(error: unknown): never {
  if (error instanceof ProfileOwnershipError) throw error;
  if (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    typeof error.errcode === "number" &&
    [5, 6].includes(error.errcode & 255)
  )
    fail("busy");
  return fail("unavailable");
}

/** Hold a shared read transaction for an app lifetime or EXCLUSIVE for maintenance.
 * SQLite's rollback-journal VFS supplies the kernel locks; WAL is forbidden here.
 * The gate file is permanent: never unlink it to release or reclaim ownership.
 */
export function acquireProfileOwnership(
  directory: string,
  mode: ProfileOwnershipLease["mode"],
): ProfileOwnershipLease {
  let database: NodeSqlite.DatabaseSync | undefined;
  try {
    if (mode !== "application" && mode !== "maintenance") fail("invalid-mode");
    if (!NodePath.isAbsolute(directory)) fail("absolute-path-required");
    const parent = NodePath.dirname(directory);
    NodeFS.mkdirSync(parent, { recursive: true, mode: 0o700 });
    safeDirectory(parent);
    NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
    safeDirectory(directory);
    const file = NodePath.join(directory, "ownership.sqlite");
    try {
      const fd = NodeFS.openSync(file, "wx", 0o600);
      NodeFS.closeSync(fd);
    } catch (error) {
      if (
        !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
    const identity = safeFile(file);
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try {
        safeFile(file + suffix);
      } catch (error) {
        if (
          !(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
    }
    database = new NodeSqlite.DatabaseSync(file, { enableForeignKeyConstraints: true });
    database.exec("PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF");
    if (database.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete")
      fail("unsupported-journal-mode");
    if (
      !database
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ownership_format'")
        .get()
    ) {
      database.exec("BEGIN IMMEDIATE");
      if (!database.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get()) {
        database.exec(
          "CREATE TABLE ownership_format (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1)); INSERT INTO ownership_format VALUES (1,1)",
        );
      }
      database.exec("COMMIT");
    }
    const version = database
      .prepare("SELECT version FROM ownership_format WHERE id=1")
      .get()?.version;
    if (version !== 1) fail("unknown-format");
    database.exec(mode === "maintenance" ? "BEGIN EXCLUSIVE" : "BEGIN");
    // BEGIN alone is deferred and does not yet hold a shared lock.
    if (database.prepare("SELECT version FROM ownership_format WHERE id=1").get()?.version !== 1)
      fail("unknown-format");
    const owned = database;
    let released = false;
    const assertHeld = () => {
      try {
        // Node 23.11 lacks this diagnostic getter. The connection is private and
        // receives no SQL after acquisition, so only release can end its lease.
        // BEGIN/SELECT above acquire the same kernel locks on every runtime.
        if (released || owned.isTransaction === false) fail("released");
        safeDirectory(parent);
        safeDirectory(directory);
        const current = safeFile(file);
        if (current.dev !== identity.dev || current.ino !== identity.ino) fail("replaced-file");
      } catch (error) {
        classify(error);
      }
    };
    assertHeld();
    return {
      mode,
      assertHeld,
      release: () => {
        if (released) return;
        released = true;
        // Close releases kernel locks even after a process crash; there is no
        // stale-PID deletion or timeout-based lock stealing.
        owned.close();
      },
    };
  } catch (error) {
    try {
      database?.close();
    } catch {
      /* Preserve the sanitized acquisition error. */
    }
    return classify(error);
  }
}
