// @effect-diagnostics nodeBuiltinImport:off - Kernel locking tests use only disposable directories and owned subprocesses.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeSqlite from "node:sqlite";
import { afterEach, expect, it } from "vite-plus/test";
import { acquireProfileOwnership } from "./profileOwnership.ts";
const homes: string[] = [];
const children: Array<{ child: NodeChildProcess.ChildProcess; closed: Promise<void> }> = [];
async function fixture() {
  const home = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "upcomputer-ownership-")),
  );
  homes.push(home);
  return NodePath.join(home, "gate");
}
async function owner(directory: string, mode: "application" | "maintenance") {
  const child = NodeChildProcess.fork(
    NodeURL.fileURLToPath(new URL("./profileOwnership.fixture.ts", import.meta.url)),
    [directory, mode],
    {
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { HOME: NodePath.dirname(directory), PATH: process.env.PATH },
      timeout: 10000,
      killSignal: "SIGKILL",
    },
  );
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  children.push({ child, closed });
  const status = await new Promise<unknown>((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", () => resolve("exited-without-status"));
  });
  return { child, closed, status };
}
afterEach(async () => {
  for (const { child, closed } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
  for (const home of homes.splice(0)) await NodeFSP.rm(home, { recursive: true, force: true });
});
it("real shared owners exclude maintenance until the last process exits", async () => {
  const directory = await fixture(),
    a = await owner(directory, "application"),
    b = await owner(directory, "application");
  expect(a.status).toBe("held");
  expect(b.status).toBe("held");
  expect((await owner(directory, "maintenance")).status).toBe("busy");
  a.child.send("release");
  await a.closed;
  expect((await owner(directory, "maintenance")).status).toBe("busy");
  b.child.kill("SIGKILL");
  await b.closed;
  expect((await owner(directory, "maintenance")).status).toBe("held");
});
it("exclusive maintenance excludes applications and another maintenance process, including after crashes", async () => {
  const directory = await fixture(),
    maintenance = await owner(directory, "maintenance");
  expect(maintenance.status).toBe("held");
  expect((await owner(directory, "application")).status).toBe("busy");
  expect((await owner(directory, "maintenance")).status).toBe("busy");
  maintenance.child.kill("SIGKILL");
  await maintenance.closed;
  expect((await owner(directory, "application")).status).toBe("held");
});
it("does not use PID files to steal a lock and detects a replaced gate file", async () => {
  const directory = await fixture(),
    lease = acquireProfileOwnership(directory, "application");
  try {
    expect(() => acquireProfileOwnership(directory, "maintenance")).toThrow();
    expect((await owner(directory, "maintenance")).status).toBe("busy");
    await NodeFSP.rename(
      NodePath.join(directory, "ownership.sqlite"),
      NodePath.join(directory, "retained.sqlite"),
    );
    await NodeFSP.writeFile(NodePath.join(directory, "ownership.sqlite"), "");
    expect(() => lease.assertHeld()).toThrow("replaced-file");
  } finally {
    lease.release();
    lease.release();
  }
  expect(() => lease.assertHeld()).toThrow("released");
});
it("rejects WAL mode, corrupt gates and symlinks rather than weakening exclusion", async () => {
  for (const kind of ["wal", "corrupt", "symlink"]) {
    const directory = await fixture();
    await NodeFSP.mkdir(directory);
    const file = NodePath.join(directory, "ownership.sqlite");
    if (kind === "wal") {
      const db = new NodeSqlite.DatabaseSync(file);
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE another(id INTEGER)");
      db.close();
    }
    if (kind === "corrupt") await NodeFSP.writeFile(file, "invalid database");
    if (kind === "symlink") {
      const target = NodePath.join(NodePath.dirname(directory), "untouched");
      await NodeFSP.writeFile(target, "untouched");
      await NodeFSP.symlink(target, file);
    }
    expect(() => acquireProfileOwnership(directory, "maintenance")).toThrow();
  }
});
