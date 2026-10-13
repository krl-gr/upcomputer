// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

const SOCKET_NAMESPACE_ENV = "OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE" as const;
const AGENT_REQUEST_TIMEOUT_MS = 1_000;

/**
 * Where the macOS helper's app agent listens, as open-computer-use 0.3.5
 * computes it (`openComputerUseAppAgentSocketFileName` in the helper).
 */
export function computerUseAppAgentSocketPath(input?: {
  readonly tmpdir?: string;
  readonly env?: NodeJS.ProcessEnv;
}): string {
  const namespace = (input?.env ?? process.env)[SOCKET_NAMESPACE_ENV]?.trim();
  const fileName = namespace
    ? `open-computer-use-agent-${NodeCrypto.createHash("sha256").update(namespace).digest("hex").slice(0, 16)}.sock`
    : "open-computer-use-agent.sock";
  return NodePath.join(input?.tmpdir ?? NodeOS.tmpdir(), fileName);
}

function samePath(left: string, right: string): boolean {
  const real = (path: string) => {
    try {
      return NodeFS.realpathSync(path);
    } catch {
      return NodePath.resolve(path);
    }
  };
  return real(left) === real(right);
}

async function requestTermination(socketPath: string, executablePath: string): Promise<boolean> {
  const socket = NodeNet.createConnection(socketPath);
  socket.setTimeout(AGENT_REQUEST_TIMEOUT_MS, () =>
    socket.destroy(new Error("The Computer Use app agent did not answer.")),
  );
  // Settles only by failing: an error, the idle timeout, or the agent hanging up.
  const closed = new Promise<never>((_, reject) => {
    socket.on("error", reject);
    socket.on("close", () =>
      reject(new Error("The Computer Use app agent closed the connection.")),
    );
  });
  closed.catch(() => undefined);
  const lines = NodeReadline.createInterface({ input: socket })[Symbol.asyncIterator]();
  const request = async (kind: string): Promise<Record<string, unknown>> => {
    socket.write(`${JSON.stringify({ kind })}\n`);
    const line = await Promise.race([lines.next(), closed]);
    if (line.done) throw new Error("The Computer Use app agent closed the connection.");
    return JSON.parse(line.value) as Record<string, unknown>;
  };
  try {
    await Promise.race([new Promise((resolve) => socket.once("connect", resolve)), closed]);
    const info = await request("agentInfo");
    // Another app's helper can own the default socket; leave it alone.
    if (typeof info.executableURL !== "string" || !samePath(info.executableURL, executablePath)) {
      return false;
    }
    await request("terminate");
    return true;
  } finally {
    socket.destroy();
  }
}

/**
 * Quits the helper's app agent if it is ours. On macOS the sidecar proxies
 * `doctor` and `mcp` to a second Open Computer Use.app instance that
 * LaunchServices starts outside our process tree. It owns the permission
 * window and never quits on its own, so stopping our children leaves it behind.
 */
export async function stopComputerUseAppAgent(input: {
  readonly executablePath: string;
  readonly socketPath?: string;
}): Promise<boolean> {
  const socketPath = input.socketPath ?? computerUseAppAgentSocketPath();
  if (!NodeFS.existsSync(socketPath)) return false;
  return requestTermination(socketPath, input.executablePath).catch(() => false);
}
