// @effect-diagnostics nodeBuiltinImport:off - Isolated subprocess lock fixture.
import * as NodePath from "node:path";
import { acquireProfileOwnership, ProfileOwnershipError } from "./profileOwnership.ts";
const directory = process.argv[2],
  mode = process.argv[3];
if (
  !directory ||
  !NodePath.basename(NodePath.dirname(directory)).startsWith("upcomputer-ownership-") ||
  (mode !== "application" && mode !== "maintenance")
)
  throw new Error("Fixture directory required");
try {
  const lease = acquireProfileOwnership(directory, mode);
  process.send?.("held");
  process.on("message", (message) => {
    if (message === "release") {
      lease.release();
      process.exit(0);
    }
  });
} catch (error) {
  process.send?.(error instanceof ProfileOwnershipError ? error.code : "unexpected");
  process.exitCode = 1;
  process.disconnect?.();
}
