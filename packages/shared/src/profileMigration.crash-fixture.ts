// @effect-diagnostics nodeBuiltinImport:off - Subprocess fixture, never an application entry point.
import * as NodePath from "node:path";
import { migrateProfile, profileMigrationDirectory } from "./profileMigration.ts";

const home = process.argv[2];
const phase = process.argv[3];
if (!home || !NodePath.basename(home).startsWith("upcomputer-profile-migration-"))
  throw new Error("Disposable fixture required");
await migrateProfile(
  {
    directory: profileMigrationDirectory(home),
    roots: [
      {
        id: "backend",
        source: NodePath.join(home, ".t3"),
        destination: NodePath.join(home, ".upcomputer"),
      },
      {
        id: "electron",
        source: NodePath.join(home, "t3code"),
        destination: NodePath.join(home, "UpComputer"),
      },
    ],
  },
  {
    adapter: {
      acquireOfflineLease: async () => ({ assertHeld: async () => {}, release: async () => {} }),
      prepare: async () => {},
      validate: async () => {},
    },
    checkpoint: async (at) => {
      if (at === phase) process.kill(process.pid, "SIGKILL");
    },
  },
);
throw new Error("Expected fixture crash did not occur");
