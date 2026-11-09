import { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime/state/terminal";

import { connectionAtomRuntime } from "../connection/runtime";
import { terminalFirstAttachGrid } from "./terminalSpawnGate.upcomputer";

export const terminalEnvironment = createTerminalEnvironmentAtoms(connectionAtomRuntime, {
  firstAttachGrid: terminalFirstAttachGrid,
});
