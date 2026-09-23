import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeTimersPromises from "node:timers/promises";
import {
  migrateProfile,
  profileMigrationDirectory,
} from "../packages/shared/src/profileMigration.ts";

const entry = process.env.UPCOMPUTER_TEST_SERVER_ENTRY;
NodeTest.test(
  "bundled backend blocks pending migration and remaps an old override after commit",
  {
    // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Windows needs a separately verified USERPROFILE/APPDATA isolation launcher before this native test can run there.
    skip: !entry || process.platform === "win32",
    timeout: 45000,
  },
  async () => {
    const home = await NodeFSP.realpath(
      await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "upcomputer-server-migration-startup-")),
    );
    let child;
    let closed;
    try {
      const source = NodePath.join(home, ".t3");
      const destination = NodePath.join(home, ".upcomputer");
      await NodeFSP.mkdir(source);
      await NodeFSP.mkdir(NodePath.join(home, "tmp"));
      await NodeFSP.writeFile(NodePath.join(source, "fixture"), "synthetic");
      const plan = {
        directory: profileMigrationDirectory(home),
        roots: [{ id: "backend", source, destination }],
      };
      const adapter = {
        acquireOfflineLease: async () => ({ assertHeld: async () => {}, release: async () => {} }),
        prepare: async () => {},
        validate: async () => {},
      };
      await NodeAssert.rejects(
        migrateProfile(plan, {
          adapter,
          checkpoint: async (phase) => {
            if (phase === "prepared") throw new Error("fixture interruption");
          },
        }),
      );
      const probe = NodeNet.createServer();
      await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const port = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      const launch = () => {
        const spawned = NodeChildProcess.spawn(process.execPath, [entry], {
          cwd: home,
          env: {
            HOME: home,
            PATH: "/usr/bin:/bin",
            TMPDIR: NodePath.join(home, "tmp"),
            UPCOMPUTER_HOME: source,
            UPCOMPUTER_PORT: String(port),
            UPCOMPUTER_HOST: "127.0.0.1",
            UPCOMPUTER_NO_BROWSER: "true",
            UPCOMPUTER_TELEMETRY_ENABLED: "false",
            PI_OFFLINE: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30000,
          killSignal: "SIGKILL",
        });
        child = spawned;
        closed = new Promise((resolve, reject) => {
          spawned.once("error", reject);
          spawned.once("close", (code) => resolve(code));
        });
        // Pairing URLs must never enter verification output.
        spawned.stdout.on("data", () => {});
        spawned.stderr.on("data", () => {});
        return spawned;
      };
      let refused = false;
      const blocked = launch();
      for (const stream of [blocked.stdout, blocked.stderr])
        stream.on("data", (chunk) => {
          if (chunk.toString().includes("startup-check-failed")) refused = true;
        });
      NodeAssert.notEqual(await closed, 0);
      NodeAssert.ok(refused, "Expected the migration startup guard, not an unrelated launch error");
      await NodeAssert.rejects(NodeFSP.stat(destination), { code: "ENOENT" });
      await NodeAssert.rejects(NodeFSP.stat(NodePath.join(source, "userdata")), { code: "ENOENT" });
      await migrateProfile(plan, { adapter });
      launch();
      let ready = false;
      for (let i = 0; i < 100 && child.exitCode === null; i++) {
        try {
          const response = await fetch(
            `http://127.0.0.1:${port}/.well-known/upcomputer/environment`,
            { signal: AbortSignal.timeout(500) },
          );
          await response.body?.cancel();
          if (response.status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Owned server is still starting. */
        }
        await NodeTimersPromises.setTimeout(100);
      }
      NodeAssert.ok(ready, "Isolated backend did not become ready");
      await NodeFSP.stat(NodePath.join(destination, "userdata", "state.sqlite"));
      await NodeAssert.rejects(NodeFSP.stat(NodePath.join(source, "userdata")), { code: "ENOENT" });
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
        try {
          await closed;
        } finally {
          clearTimeout(deadline);
        }
      }
      await NodeFSP.rm(home, { recursive: true, force: true });
    }
  },
);
