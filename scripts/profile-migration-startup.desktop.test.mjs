import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";
import {
  migrateProfile,
  profileMigrationDirectory,
} from "../packages/shared/src/profileMigration.ts";

NodeTest.test(
  "macOS Electron entry refuses a partial profile before Clerk/crypto/backend startup",
  {
    // oxlint-disable-next-line upcomputer/no-global-process-runtime -- Standalone native launcher must check the actual host, outside the application Effect runtime.
    skip: process.env.UPCOMPUTER_TEST_NATIVE_PROFILE_GUARD !== "1" || process.platform !== "darwin",
    timeout: 20000,
  },
  async () => {
    const home = await NodeFSP.realpath(
      await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "upcomputer-electron-migration-guard-")),
    );
    let child;
    let closed;
    try {
      const source = NodePath.join(home, ".t3");
      await NodeFSP.mkdir(source);
      await NodeFSP.writeFile(NodePath.join(source, "fixture"), "synthetic profile");
      await NodeAssert.rejects(
        migrateProfile(
          {
            directory: profileMigrationDirectory(home),
            roots: [{ id: "backend", source, destination: NodePath.join(home, ".upcomputer") }],
          },
          {
            adapter: {
              acquireOfflineLease: async () => ({
                assertHeld: async () => {},
                release: async () => {},
              }),
              prepare: async () => {},
              validate: async () => {},
            },
            checkpoint: async (phase) => {
              if (phase === "prepared") throw new Error("fixture interruption");
            },
          },
        ),
      );
      for (const name of ["appdata", "electron-runtime", "tmp"])
        await NodeFSP.mkdir(NodePath.join(home, name));
      const main = NodeURL.fileURLToPath(
        new URL("../apps/desktop/dist-electron/main.cjs", import.meta.url),
      );
      await NodeFSP.access(main);
      const entry = NodePath.join(home, "guard-fixture.cjs");
      await NodeFSP.writeFile(
        entry,
        `
const Electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const home = ${JSON.stringify(home)};
Electron.app.setName("UpComputer Migration Guard Fixture");
Electron.app.setPath("home", home);
Electron.app.setPath("appData", path.join(home, "appdata"));
Electron.app.setPath("userData", path.join(home, "electron-runtime"));
Electron.app.setPath("sessionData", path.join(home, "electron-runtime"));
// Prevent any OS keychain access even if the startup-order assertion regresses.
for (const method of ["encryptString", "decryptString", "isEncryptionAvailable"]) {
  Electron.safeStorage[method] = () => { fs.writeFileSync(path.join(home, "unexpected-crypto"), method); throw new Error("Unexpected crypto before startup guard"); };
}
Electron.dialog.showErrorBox = (title, message) => {
  if (title !== "Up.computer profile maintenance" || !message.includes("No profile has been opened")) throw new Error("Unexpected startup error");
  fs.writeFileSync(path.join(home, "guard-observed"), "blocked");
};
require(${JSON.stringify(main)});
fs.writeFileSync(path.join(home, "unexpected-continuation"), "continued");
`,
      );
      const require = NodeModule.createRequire(
        new URL("../apps/desktop/package.json", import.meta.url),
      );
      child = NodeChildProcess.spawn(require("electron"), [entry], {
        env: {
          HOME: home,
          PATH: "/usr/bin:/bin",
          TMPDIR: NodePath.join(home, "tmp"),
          UPCOMPUTER_HOME: source,
        },
        stdio: "ignore",
      });
      closed = new Promise((resolve) => child.once("close", resolve));
      const deadline = setTimeout(() => child.kill("SIGKILL"), 15000);
      try {
        const code = await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", resolve);
        });
        NodeAssert.equal(code, 1);
      } finally {
        clearTimeout(deadline);
      }
      NodeAssert.equal(
        await NodeFSP.readFile(NodePath.join(home, "guard-observed"), "utf8"),
        "blocked",
      );
      for (const name of [
        "unexpected-crypto",
        "unexpected-continuation",
        ".t3/userdata",
        ".upcomputer",
      ]) {
        await NodeAssert.rejects(NodeFSP.stat(NodePath.join(home, name)), { code: "ENOENT" });
      }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await closed;
      await NodeFSP.rm(home, { recursive: true, force: true });
    }
  },
);
