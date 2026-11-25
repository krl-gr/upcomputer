// @effect-diagnostics nodeBuiltinImport:off - the scenario stages a fake opencode binary it can kill.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

const MODEL = { providerID: "opencode", modelID: "big-pickle" };

// `opencode serve` as Up.computer starts it: it prints its URL, keeps sessions in memory, answers
// each prompt with REPLY_<n>, and records its pid so the scenario can kill it mid-session.
const FAKE_OPENCODE = `
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) {
  console.log("1.19.6");
  process.exit(0);
}
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const MODEL = ${JSON.stringify(MODEL)};
const ROOT = "ses_scenario_root";
const streams = new Set();
let sequence = 0;
let replies = Number(fs.existsSync(process.env.FAKE_COUNT) ? fs.readFileSync(process.env.FAKE_COUNT, "utf8") : "0");
const emit = (type, properties) => {
  const frame = "data: " + JSON.stringify({ id: "evt_" + ++sequence, type, properties }) + "\\n\\n";
  for (const stream of streams) stream.write(frame);
};
const session = { id: ROOT, slug: ROOT, version: "1.19.6", projectID: "global", directory: "/tmp", title: ROOT, time: { created: 1, updated: 1 } };
const runPrompt = (messageID) => {
  replies += 1;
  fs.writeFileSync(process.env.FAKE_COUNT, String(replies));
  fs.writeFileSync(process.env.FAKE_PID, String(process.pid));
  const id = "msg_answer_" + replies;
  const info = { id, parentID: messageID, sessionID: ROOT, role: "assistant", mode: "build", agent: "build", path: { cwd: "/tmp", root: "/" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, ...MODEL };
  emit("message.updated", { sessionID: ROOT, info: { id: messageID, sessionID: ROOT, role: "user", time: { created: 1 }, agent: "build", model: MODEL } });
  emit("session.status", { sessionID: ROOT, status: { type: "busy" } });
  emit("message.updated", { sessionID: ROOT, info: { ...info, time: { created: 2 } } });
  emit("message.part.updated", { sessionID: ROOT, part: { id: "prt_" + id, messageID: id, sessionID: ROOT, type: "text", text: "REPLY_" + replies }, time: 2 });
  emit("message.updated", { sessionID: ROOT, info: { ...info, time: { created: 2, completed: 3 }, finish: "stop" } });
  emit("session.status", { sessionID: ROOT, status: { type: "idle" } });
  emit("session.idle", { sessionID: ROOT });
};
const server = http.createServer(async (request, response) => {
  const route = new URL(request.url ?? "/", "http://opencode").pathname;
  let body = "";
  for await (const chunk of request) body += chunk;
  const json = (value) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (route === "/event") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write("data: " + JSON.stringify({ type: "server.connected", properties: {} }) + "\\n\\n");
    streams.add(response);
    request.on("close", () => streams.delete(response));
    return;
  }
  if (route === "/global/health") return json({ healthy: true, version: "1.19.6" });
  if (route === "/provider") {
    const model = { id: MODEL.modelID, name: "Big Pickle", release_date: "2026-01-01" };
    return json({ all: [{ id: MODEL.providerID, name: "OpenCode Zen", models: { [model.id]: model } }], default: { [MODEL.providerID]: model.id }, connected: [MODEL.providerID] });
  }
  if (route === "/agent") return json([{ name: "build", mode: "primary" }]);
  if (route === "/session/status") return json({});
  if (route === "/session" && request.method === "POST") return json(session);
  const match = /^\\/session\\/([^/]+)(?:\\/([a-z_]+))?$/.exec(route);
  if (match !== null) {
    const action = match[2];
    if (action === undefined) return json(session);
    if (action === "abort") return json(true);
    if (action === "prompt_async") {
      response.writeHead(204).end();
      return runPrompt(JSON.parse(body).messageID);
    }
  }
  json([]);
});
server.listen(Number(portArg?.slice("--port=".length) ?? 0), "127.0.0.1", () => {
  console.log("opencode server listening on http://127.0.0.1:" + server.address().port);
});
`;

test(
  "A thread continues after its OpenCode server crashed, without restarting the app",
  WEB,
  async ({ t3, app, screen }) => {
    const project = await t3.project("demo");
    // Outside the project, so the binary stays out of the turn's diff.
    const fake = NodePath.join(T3_HOME, "fake-opencode");
    await NodeFSP.mkdir(fake, { recursive: true });
    const pidFile = NodePath.join(fake, "pid");
    await NodeFSP.writeFile(NodePath.join(fake, "opencode.cjs"), FAKE_OPENCODE);
    const binary = NodePath.join(fake, "opencode");
    await NodeFSP.writeFile(
      binary,
      `#!/bin/sh\nFAKE_PID="${pidFile}" FAKE_COUNT="${NodePath.join(fake, "count")}" exec "${process.execPath}" "${NodePath.join(fake, "opencode.cjs")}" "$@"\n`,
    );
    await NodeFSP.chmod(binary, 0o755);
    const settingsPath = NodePath.join(T3_HOME, "userdata/settings.json");
    const settings = JSON.parse(await NodeFSP.readFile(settingsPath, "utf8"));
    settings.providerInstances.opencode = {
      driver: "opencode",
      enabled: true,
      config: { binaryPath: binary },
    };
    await NodeFSP.writeFile(settingsPath, JSON.stringify(settings));

    const { cli } = makeState(T3_HOME);
    const start = [
      "thread",
      "start",
      project,
      "Write a tomato salad recipe.",
      "--title",
      "Crash and continue",
      "--provider",
      "opencode",
      "--model",
      `${MODEL.providerID}/${MODEL.modelID}`,
      "--json",
    ];
    // The settings watcher enables OpenCode a moment after the write.
    let started = "";
    await expect
      .poll(
        async () => {
          const result = await runPromise(cli(start, [0, 1])).catch(() => undefined);
          if (result?.stdout.includes("threadId")) started = result.stdout;
          return started.length > 0;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const { threadId } = JSON.parse(started) as { threadId: string };
    await t3.open({ threadId });
    await expect(screen.getByText("REPLY_1")).toBeVisible({ timeout: 60_000 });

    // The server dies between turns, as when its process is killed.
    process.kill(Number(await NodeFSP.readFile(pidFile, "utf8")), "SIGKILL");
    await runPromise(cli(["thread", "send", threadId, "Please continue.", "--json"], [0, 1]));
    await expect(screen.getByText("REPLY_2")).toBeVisible({ timeout: 60_000 });
    await app.screenshot("continued");
  },
);
