// @effect-diagnostics nodeBuiltinImport:off - Reads one JSON file and signals one PID the server itself recorded.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

const STOP_GRACE_MS = 5_000;
const POLL_MS = 100;

interface RuntimeRecord {
  readonly pid: number;
  readonly serviceManaged: boolean;
  readonly desktopParentPid: number | null;
}

const isPid = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

function readRuntimeRecord(stateDir: string): RuntimeRecord | null {
  try {
    const parsed: unknown = JSON.parse(
      NodeFS.readFileSync(NodePath.join(stateDir, "server-runtime.json"), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const { pid, serviceManaged, desktopParentPid } = parsed as Record<string, unknown>;
    return isPid(pid)
      ? {
          pid,
          serviceManaged: serviceManaged === true,
          desktopParentPid: isPid(desktopParentPid) ? desktopParentPid : null,
        }
      : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The executable a PID runs, or null when the OS won't say. */
function executableOf(pid: number, platform: string): string | null {
  if (platform === "win32") return null;
  // Linux `ps -o comm=` is only the 15-character process name, not a path.
  if (platform === "linux") {
    try {
      return NodeFS.readlinkSync(`/proc/${pid}/exe`);
    } catch {
      return null;
    }
  }
  try {
    return NodeChildProcess.execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim();
  } catch {
    return null;
  }
}

function canonicalPath(path: string): string {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The PID of a server this app started and then lost, for example after a
 * forced quit: the desktop app that launched it is gone, yet it still owns the
 * data folder and runs this app's own binary. A server started from the CLI,
 * the background service, another app or a reused PID is never returned.
 */
export const findOrphanedBackend = Effect.fn("DesktopOrphanedBackend.findOrphanedBackend")(
  function* (stateDir: string, executablePath: string) {
    const platform = yield* HostProcess.Platform;
    const record = readRuntimeRecord(stateDir);
    if (record === null || record.serviceManaged) return null;
    // The CLI shim runs the same binary on the same data; only a server whose
    // launching desktop app has died is leftover.
    if (record.desktopParentPid === null || isAlive(record.desktopParentPid)) return null;
    if (record.pid === process.pid || !isAlive(record.pid)) return null;
    const executable = executableOf(record.pid, platform);
    if (executable === null) return null;
    // Only the exact binary of this app: other Electron apps share a basename.
    return canonicalPath(executable) === canonicalPath(executablePath) ? record.pid : null;
  },
);

/** Asks the leftover server to stop, then forces it; true once it is gone. */
export const stopOrphanedBackend = Effect.fn("DesktopOrphanedBackend.stopOrphanedBackend")(
  function* (pid: number) {
    yield* Effect.sync(() => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    });
    for (let waited = 0; waited < STOP_GRACE_MS; waited += POLL_MS) {
      if (!isAlive(pid)) return true;
      yield* Effect.sleep(POLL_MS);
    }
    yield* Effect.sync(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    });
    yield* Effect.sleep(POLL_MS * 5);
    return !isAlive(pid);
  },
);
