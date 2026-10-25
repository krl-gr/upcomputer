// @effect-diagnostics nodeBuiltinImport:off - Exercises a real inherited pipe and process exit in a subprocess.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import { expect, it } from "vite-plus/test";

// On Windows a child kill is TerminateProcess, so this message is the desktop's only graceful stop.
it("runs the server's shutdown finalizers when the desktop asks it to stop", async () => {
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      NodeURL.fileURLToPath(
        new URL("./testing/DesktopShutdownRequest.fixture.ts", import.meta.url),
      ),
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] },
  );
  // @effect-diagnostics-next-line globalTimers:off -- Bounds the native subprocess on failure; success waits for process exit.
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 8_000);
  let output = "";
  let errors = "";
  const lines: Array<string> = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    let end: number;
    while ((end = output.indexOf("\n")) >= 0) {
      const line = output.slice(0, end);
      output = output.slice(end + 1);
      lines.push(line);
      if (line === "ready") {
        const pipe = child.stdio[4];
        if (!pipe || !("write" in pipe)) throw new Error("Missing pipe 4");
        pipe.write(`${JSON.stringify({ version: 1, type: "desktopShutdownRequest" })}\n`);
      }
    }
  });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    expect(errors).not.toContain("Error");
    expect(lines).toEqual(["ready", "stopped"]);
    // runMain's exit code for a stop by signal.
    expect(result).toEqual({ code: 130, signal: null });
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const stream of child.stdio) stream?.destroy();
  }
});
