// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/process";
import { onTestFinished, test } from "vite-plus/test";

import type { ServerConfig } from "../../../../apps/server/src/config.ts";
import { stopComputerUseAppAgent } from "./ComputerUseAppAgent.ts";
import { createComputerUseService } from "./ComputerUseService.ts";

function temporaryDirectory(): string {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cu-agent-"));
  onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Answers like the helper's app agent and records the request kinds it got. */
async function startFakeAgent(socketPath: string, executableURL: string) {
  const requests: string[] = [];
  const server = NodeNet.createServer((socket) => {
    NodeReadline.createInterface({ input: socket }).on("line", (line) => {
      const { kind } = JSON.parse(line) as { kind: string };
      requests.push(kind);
      const response = kind === "agentInfo" ? { executableURL } : { ok: true };
      socket.write(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return requests;
}

/** A service over a settings file that points Computer Use at `binaryPath`. */
function serviceFor(
  binaryPath: string,
  stopAppAgent: (executablePath: string) => Promise<unknown>,
) {
  const directory = temporaryDirectory();
  const settingsPath = NodePath.join(directory, "settings.json");
  NodeFS.writeFileSync(
    NodePath.join(directory, "computer-use.json"),
    JSON.stringify({ computerUse: { binaryPath } }),
  );
  const spawned: string[][] = [];
  const childProcessSpawner = ChildProcessSpawner.make((command) => {
    spawned.push("args" in command ? [...command.args] : []);
    return Effect.die(new Error("the helper is not available in tests"));
  });
  const service = createComputerUseService({ settingsPath } as ServerConfig["Service"], {
    childProcessSpawner,
    stopAppAgent,
  });
  return { service, spawned };
}

test("stopping quits our app agent, which macOS launched outside our process tree", async () => {
  const directory = temporaryDirectory();
  const executablePath = NodePath.join(directory, "OpenComputerUse");
  NodeFS.writeFileSync(executablePath, "");
  const socketPath = NodePath.join(directory, "agent.sock");
  const requests = await startFakeAgent(socketPath, executablePath);
  const { service } = serviceFor(executablePath, (path) =>
    stopComputerUseAppAgent({ executablePath: path, socketPath }),
  );

  await service.stop();

  NodeAssert.deepEqual(requests, ["agentInfo", "terminate"]);
});

test("another app's agent on the shared socket is left running", async () => {
  const directory = temporaryDirectory();
  const socketPath = NodePath.join(directory, "agent.sock");
  const requests = await startFakeAgent(socketPath, "/Applications/Other.app/Contents/MacOS/Other");

  const stopped = await stopComputerUseAppAgent({
    executablePath: NodePath.join(directory, "OpenComputerUse"),
    socketPath,
  });

  NodeAssert.equal(stopped, false);
  NodeAssert.deepEqual(requests, ["agentInfo"]);
});

test("without a running agent there is nothing to stop", async () => {
  const directory = temporaryDirectory();

  const stopped = await stopComputerUseAppAgent({
    executablePath: NodePath.join(directory, "OpenComputerUse"),
    socketPath: NodePath.join(directory, "agent.sock"),
  });

  NodeAssert.equal(stopped, false);
});

test("reading the status never runs the helper, whose doctor opens the permission window", async () => {
  const { service, spawned } = serviceFor("/opt/OpenComputerUse", async () => undefined);

  await service.snapshot();
  await service.snapshot();
  NodeAssert.deepEqual(spawned, []);

  await service.doctor();
  NodeAssert.deepEqual(spawned, [["doctor"]]);
});
