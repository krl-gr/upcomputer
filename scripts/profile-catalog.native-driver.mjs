// Run only inside the disposable Tart guest with Electron's Node mode.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeTimersPromises from "node:timers/promises";

NodeAssert.equal(process.env.UPCOMPUTER_NATIVE_FIXTURE, "tart-profile-v1");
// oxlint-disable-next-line upcomputer/no-global-process-runtime -- Native fixture must reject other operating systems before touching OS encryption.
NodeAssert.equal(NodeOS.platform(), "darwin");
NodeAssert.match(
  NodeChildProcess.execFileSync("/usr/sbin/sysctl", ["-n", "hw.model"], {
    encoding: "utf8",
  }).trim(),
  /^VirtualMac/,
);
const root = NodePath.join(NodeOS.homedir(), "UpComputer-Native-Profile-Fixture");
NodeAssert.equal(NodeFS.readFileSync(NodePath.join(root, ".fixture"), "utf8"), "synthetic-only\n");
const app = "/Applications/Up.computer (Alpha).app";
const binary = NodeChildProcess.execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleExecutable", NodePath.join(app, "Contents/Info.plist")],
  { encoding: "utf8" },
).trim();
const port = 19579;
const results = [];
const identityMode =
  process.argv[3] ?? (process.argv[2]?.startsWith("renamed-") ? "renamed" : "normal");
NodeAssert.ok(["normal", "renamed", "bridged"].includes(identityMode));
const earlyRename = identityMode !== "normal";
let earlyIdentity;

async function launch() {
  const env = {
    ...process.env,
    UPCOMPUTER_NATIVE_FIXTURE: "tart-profile-v1",
    UPCOMPUTER_HOME: NodePath.join(root, "application-backend"),
    T3CODE_HOME: NodePath.join(root, "application-backend"),
    UPCOMPUTER_DISABLE_AUTO_UPDATE: "true",
    T3CODE_DISABLE_AUTO_UPDATE: "true",
    UPCOMPUTER_TELEMETRY_ENABLED: "false",
    T3CODE_TELEMETRY_ENABLED: "false",
    PI_OFFLINE: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = NodeChildProcess.spawn(
    NodePath.join(app, "Contents/MacOS", binary),
    [`--inspect-brk=127.0.0.1:${port}`],
    { env, stdio: "ignore" },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  let socket;
  const pending = new Map();
  let counter = 0;
  const stop = async () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Owned guest process stopped"));
    }
    pending.clear();
    socket?.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const deadline = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 10000);
    try {
      await closed;
    } finally {
      clearTimeout(deadline);
    }
  };
  try {
    let url;
    for (let n = 0; n < 80 && child.exitCode === null; n++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(500),
        });
        const targets = await response.json();
        url = targets[0]?.webSocketDebuggerUrl;
        if (url) break;
      } catch {
        /* Owned app starting; never print debug endpoints. */
      }
      await NodeTimersPromises.setTimeout(250);
    }
    NodeAssert.ok(url, "Owned installed app inspector unavailable");
    const endpoint = new URL(url);
    NodeAssert.equal(endpoint.protocol, "ws:");
    NodeAssert.equal(endpoint.hostname, "127.0.0.1");
    NodeAssert.equal(endpoint.port, String(port));
    socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let paused = false;
    let pausedAt = "";
    let callFrameId;
    const scripts = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Debugger.scriptParsed")
        scripts.set(message.params.scriptId, message.params.url);
      if (message.method === "Debugger.paused") {
        paused = true;
        const frame = message.params.callFrames[0];
        callFrameId = frame.callFrameId;
        pausedAt = frame.url || scripts.get(frame.location.scriptId) || "";
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error || message.result?.exceptionDetails)
        entry.reject(new Error("Guest probe evaluation failed"));
      else entry.resolve(message.result?.result?.value);
    });
    const request = (method, params) =>
      new Promise((resolve, reject) => {
        if (earlyRename) console.log(`Guest debugger step: ${method}`);
        const id = ++counter;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Guest ${method} timed out; check guest OS prompts`));
        }, 45000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = (expression) =>
      request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    {
      await request("Debugger.enable", {});
      await request("Debugger.setBreakpointByUrl", {
        lineNumber: 0,
        urlRegex: "dist-electron/main\\.cjs$",
      });
      await request("Runtime.runIfWaitingForDebugger", {});
      for (let i = 0; i < 100; i++) {
        if (paused) break;
        await NodeTimersPromises.setTimeout(50);
      }
      NodeAssert.ok(paused, "No verified pre-main debugger pause");
      if (!pausedAt.endsWith("dist-electron/main.cjs")) {
        paused = false;
        await request("Debugger.resume", {});
        for (let i = 0; i < 100; i++) {
          if (paused) break;
          await NodeTimersPromises.setTimeout(50);
        }
      }
      NodeAssert.ok(
        paused && pausedAt.endsWith("dist-electron/main.cjs"),
        "Not paused in app entry",
      );
      await request("Debugger.setBreakpointsActive", { active: false });
      const identity = await request("Debugger.evaluateOnCallFrame", {
        callFrameId,
        returnByValue: true,
        expression: `(()=>{if(process.pid!==${child.pid})throw Error('Inspector owner mismatch');const e=process.mainModule.require('electron');if(e.app.isReady())throw Error('Too late');${earlyRename ? `e.app.setName('upcomputer');` : ""}${identityMode === "bridged" ? `process.mainModule.require(${JSON.stringify(NodePath.join(root, "probe.cjs"))}).configureCompatibility();` : ""}return {name:e.app.getName(),ready:e.app.isReady()}})()`,
      });
      NodeAssert.equal(identity.name, identityMode === "renamed" ? "upcomputer" : "t3code");
      earlyIdentity = identity;
      NodeAssert.equal(identity.ready, false);
      console.log(JSON.stringify({ earlyIdentity: identity }));
      await request("Debugger.resume", {});
    }
    await evaluate(
      `(async()=>{const e=process.mainModule.require('electron');await e.app.whenReady();return true})()`,
    );
    // whenReady alone precedes asynchronous product initialization.
    let runtime;
    for (let i = 0; i < 80; i++) {
      runtime = await evaluate(
        `(()=>{const e=process.mainModule.require('electron');return {name:e.app.getName(),windows:e.BrowserWindow.getAllWindows().length,ready:e.app.isReady()}})()`,
      );
      if (runtime.name === "Up.computer (Alpha)" && runtime.windows > 0) break;
      await NodeTimersPromises.setTimeout(250);
    }
    NodeAssert.equal(runtime?.name, "Up.computer (Alpha)");
    NodeAssert.ok(runtime.windows > 0, "Product initialization did not finish");
    console.log(JSON.stringify({ runtime }));
    return { stop, evaluate };
  } catch (error) {
    await stop();
    throw error;
  }
}

const action = process.argv[2] ?? "source";
NodeAssert.ok(
  [
    "source",
    "source-restart",
    "candidate",
    "prepared",
    "candidate-restart",
    "corrupt",
    "restore",
    "newer",
    "preserved-newer",
    "renamed-identity",
    "renamed-write",
    "renamed-read",
  ].includes(action),
);
const directory =
  action === "renamed-identity"
    ? "source"
    : ["renamed-write", "renamed-read"].includes(action)
      ? "candidate"
      : action === "source-restart"
        ? "source"
        : action === "candidate-restart" || action === "newer"
          ? "candidate"
          : action;
const generation = ["newer", "preserved-newer"].includes(action) ? 2 : 1;
const operation =
  action === "renamed-identity"
    ? "reject-identity"
    : ["source", "newer", "renamed-write"].includes(action)
      ? "write"
      : action === "corrupt"
        ? "reject-corrupt"
        : "read";
const running = await launch();
try {
  const result = await running.evaluate(
    `process.mainModule.require(${JSON.stringify(NodePath.join(root, "probe.cjs"))}).run(${JSON.stringify({ directory, action: operation, generation })})`,
  );
  NodeAssert.equal(result?.passed, true);
  results.push({ phase: action, identityMode, earlyIdentity, ...result });
  NodeFS.writeFileSync(
    NodePath.join(root, `result-${identityMode}-${action}.json`),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  await running.stop();
}
