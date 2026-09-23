// Closed-world synthetic fixture, NOT a production maintenance/restore adapter.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import {
  migrateProfile,
  rollbackProfileMigration,
} from "../packages/shared/src/profileMigration.ts";
import {
  acquireProfileOwnership,
  profileOwnershipDirectory,
} from "../packages/shared/src/profileOwnership.ts";

NodeAssert.equal(process.env.UPCOMPUTER_NATIVE_FIXTURE, "tart-profile-v1");
// oxlint-disable-next-line upcomputer/no-global-process-runtime -- Native fixture must reject other operating systems before touching OS encryption.
NodeAssert.equal(NodeOS.platform(), "darwin");
NodeAssert.match(
  NodeChildProcess.execFileSync("/usr/sbin/sysctl", ["-n", "hw.model"], {
    encoding: "utf8",
  }).trim(),
  /^VirtualMac/,
);
const root = NodeFS.realpathSync(
  NodePath.join(NodeOS.homedir(), "UpComputer-Native-Profile-Fixture"),
);
NodeAssert.equal(NodeFS.readFileSync(NodePath.join(root, ".fixture"), "utf8"), "synthetic-only\n");
const mode = process.argv[2];
NodeAssert.ok(["migrate", "preserve-and-restore-fixture"].includes(mode));
const plan = {
  directory: NodePath.join(root, "migration"),
  roots: [
    {
      id: "backend",
      source: NodePath.join(root, "source"),
      destination: NodePath.join(root, "candidate"),
    },
  ],
};
async function probe(phase) {
  const result = await NodeUtil.promisify(NodeChildProcess.execFile)(
    process.execPath,
    [NodePath.join(root, "driver.mjs"), phase, "bridged"],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 90000,
      killSignal: "SIGTERM",
      maxBuffer: 64 * 1024,
    },
  );
  // Driver prints only controlled fixture statuses; never forward app output.
  NodeAssert.ok(result.stdout.includes('"passed":true'));
}
const adapter = {
  acquireOfflineLease: async () => {
    const lease = acquireProfileOwnership(
      profileOwnershipDirectory(NodeOS.homedir()),
      "maintenance",
    );
    return { assertHeld: async () => lease.assertHeld(), release: async () => lease.release() };
  },
  prepare: async () => {},
  // The released app does not participate in the new gate. Here it is an owned
  // validation worker, with ordinary app data OUTSIDE the synthetic roots. All
  // fixture writers are stopped before copying. This is not old-launcher fencing.
  validate: async (_roots, phase) => probe(phase === "candidate" ? "prepared" : "candidate"),
};
const catalog = (directory) => NodePath.join(directory, "userdata", "connection-catalog.json");
if (mode === "migrate") {
  const original = NodeFS.readFileSync(catalog(plan.roots[0].source));
  NodeAssert.equal(await migrateProfile(plan, { adapter }), "complete");
  NodeAssert.deepEqual(NodeFS.readFileSync(catalog(plan.roots[0].source)), original);
  NodeAssert.deepEqual(NodeFS.readFileSync(catalog(plan.roots[0].destination)), original);
  NodeAssert.deepEqual(
    NodeFS.readFileSync(catalog(NodePath.join(root, "migration", "backup", "backend"))),
    original,
  );
  console.log(
    "PASS: verified backups and native decryption before and after publication; original unchanged",
  );
} else {
  const current = NodeFS.readFileSync(catalog(plan.roots[0].destination));
  await NodeAssert.rejects(rollbackProfileMigration(plan, { adapter }), {
    code: "activated-profile-requires-explicit-restore",
  });
  NodeAssert.deepEqual(NodeFS.readFileSync(catalog(plan.roots[0].destination)), current);
  // Demonstrate retaining newer catalog state before testing an older snapshot.
  // Do NOT replace an active profile or pretend this handles full Git/provider state.
  for (const name of ["preserved-newer", "restore"])
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(root, name)), false);
  NodeFS.cpSync(plan.roots[0].destination, NodePath.join(root, "preserved-newer"), {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false,
  });
  NodeAssert.deepEqual(
    NodeFS.readFileSync(catalog(NodePath.join(root, "preserved-newer"))),
    current,
  );
  NodeFS.cpSync(
    NodePath.join(root, "migration", "backup", "backend"),
    NodePath.join(root, "restore"),
    {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      force: false,
    },
  );
  await probe("restore");
  await probe("preserved-newer");
  NodeAssert.deepEqual(NodeFS.readFileSync(catalog(plan.roots[0].destination)), current);
  console.log(
    "PASS: automatic post-activation rollback refused; old snapshot readable and newer catalog retained separately",
  );
}
