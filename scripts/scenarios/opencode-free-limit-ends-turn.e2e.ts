// @effect-diagnostics nodeBuiltinImport:off globalDate:off - a plain Node server streams the fake OpenCode SSE feed.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

// Frames as OpenCode 1.19.6 sends them once Zen answers 429 FreeUsageLimitError: the session
// stays in "retry" until `next`, about ten hours later, and goes idle only when aborted.
const ROOT = "ses_scenario_root";
const MODEL = { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" };

function fakeOpenCode() {
  const streams = new Set<NodeHttp.ServerResponse>();
  let sequence = 0;
  const emit = (type: string, properties: unknown) => {
    const frame = `data: ${JSON.stringify({ id: `evt_${++sequence}`, type, properties })}\n\n`;
    for (const stream of streams) stream.write(frame);
  };
  const session = {
    id: ROOT,
    slug: ROOT,
    version: "1.19.6",
    projectID: "global",
    directory: "/tmp",
    title: ROOT,
    time: { created: 1, updated: 1 },
  };
  const runPrompt = (messageID: string) => {
    emit("message.updated", {
      sessionID: ROOT,
      info: { id: messageID, sessionID: ROOT, role: "user", time: { created: 1 }, model: MODEL },
    });
    emit("session.status", { sessionID: ROOT, status: { type: "busy" } });
    emit("session.status", {
      sessionID: ROOT,
      status: {
        type: "retry",
        attempt: 1,
        message: "Free usage exceeded, subscribe to Go",
        action: {
          reason: "free_tier_limit",
          provider: "opencode",
          title: "Free limit reached",
          message:
            "Subscribe to OpenCode Go for reliable access to the best open-source models for $10/month.",
          label: "subscribe",
          link: "https://opencode.ai/go",
        },
        next: Date.now() + 10 * 60 * 60 * 1_000,
      },
    });
  };

  const server = NodeHttp.createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://opencode").pathname;
    let body = "";
    for await (const chunk of request) body += chunk;
    const json = (value: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (path === "/event") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
      streams.add(response);
      request.on("close", () => streams.delete(response));
      return;
    }
    if (path === "/api/info") {
      response.writeHead(200, { "content-type": "text/html" });
      return response.end("<!doctype html>");
    }
    if (path === "/global/health") return json({ healthy: true, version: "1.19.6" });
    if (path === "/provider") {
      const model = {
        id: MODEL.modelID,
        name: "DeepSeek V4.1 Flash Free",
        release_date: "2026-01-01",
      };
      return json({
        all: [{ id: MODEL.providerID, name: "OpenCode Zen", models: { [model.id]: model } }],
        default: { [MODEL.providerID]: model.id },
        connected: [MODEL.providerID],
      });
    }
    if (path === "/agent") return json([{ name: "build", mode: "primary" }]);
    if (path === "/command" || path === "/skill") return json([]);
    if (path === "/session/status") return json({});
    if (path === "/session" && request.method === "POST") return json(session);
    const match = /^\/session\/([^/]+)(?:\/([a-z_]+))?$/.exec(path);
    if (match !== null) {
      const [, , action] = match;
      if (action === undefined) return json(session);
      if (action === "children") return json([]);
      if (action === "abort") {
        json(true);
        emit("session.status", { sessionID: ROOT, status: { type: "idle" } });
        return emit("session.idle", { sessionID: ROOT });
      }
      if (action === "prompt_async") {
        response.writeHead(204).end();
        return runPrompt(JSON.parse(body).messageID);
      }
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  return server;
}

test(
  "A turn that hits OpenCode's free limit ends with a reason instead of thinking forever",
  WEB,
  async ({ t3, app, screen }) => {
    const opencode = fakeOpenCode();
    await new Promise<void>((resolve) => opencode.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = opencode.address() as NodeNet.AddressInfo;
      const settingsPath = NodePath.join(T3_HOME, "userdata/settings.json");
      const settings = JSON.parse(await NodeFSP.readFile(settingsPath, "utf8"));
      settings.providerInstances.opencode = {
        driver: "opencode",
        enabled: true,
        config: { serverUrl: `http://127.0.0.1:${port}` },
      };
      await NodeFSP.writeFile(settingsPath, JSON.stringify(settings));

      const project = await t3.project("demo");
      const { cli } = makeState(T3_HOME);
      const start = [
        "thread",
        "start",
        project,
        "Say hi in one word.",
        "--title",
        "Free limit",
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

      // The usage-limit banner offers to resume once the limit resets.
      await expect(screen.getByText("Usage limit reached")).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole("button", "Resume at reset")).toBeVisible();
      await app.screenshot("free-limit");
      await screen.getByText("Say hi in one word.").tap();
      await app.screenshot("free-limit-turn");
    } finally {
      opencode.closeAllConnections();
      opencode.close();
    }
  },
);
