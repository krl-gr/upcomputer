import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type TerminalSummary } from "@t3tools/contracts";
import type { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { attachedTerminalSessionAtom } from "./terminalSessions";
import {
  holdTerminalSpawn,
  reportTerminalViewportGrid,
  terminalFirstAttachGrid,
} from "./terminalSpawnGate.upcomputer";

const attachCalls = vi.hoisted(() => [] as unknown[]);
const metadataAtom = await vi.hoisted(async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return Atom.make<AsyncResult.AsyncResult<ReadonlyArray<TerminalSummary>>>(
    AsyncResult.initial(true),
  );
});
vi.mock("./terminal", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    terminalEnvironment: {
      attach: (request: unknown) => {
        attachCalls.push(request);
        return Atom.make(AsyncResult.initial(true));
      },
      metadata: () => metadataAtom,
    },
  };
});
vi.mock("./session", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const granted = Atom.make(AsyncResult.success({}));
  return {
    environmentSession: { sessionStateAtom: () => granted },
    sessionHasScope: () => true,
    useEnvironmentScope: () => true,
  };
});

const environmentA = EnvironmentId.make("environment-a");
const threadA = ThreadId.make("thread-a");

const launchInput = (terminalId: string) => ({
  threadId: threadA,
  terminalId,
  cwd: "/repo",
  worktreePath: null,
  env: { T3CODE_PROJECT_ROOT: "/repo" },
});

const mountSession = (input: ReturnType<typeof launchInput>) =>
  appAtomRegistry.subscribe(attachedTerminalSessionAtom(environmentA, input), () => undefined, {
    immediate: true,
  });

describe("terminal spawn gate", () => {
  it("attaches once a viewport has a grid, keyed without it, so remounts reuse one attach", () => {
    attachCalls.length = 0;
    const input = launchInput("terminal-1");
    const unmount = mountSession(input);
    // The shell would start at the server's default size, so attaching waits for a grid.
    expect(attachCalls).toEqual([]);

    reportTerminalViewportGrid(environmentA, input, { cols: 48, rows: 20 });
    reportTerminalViewportGrid(environmentA, input, { cols: 90, rows: 30 });
    expect(attachCalls).toEqual([{ environmentId: environmentA, input }]);
    // The first attach reads the latest grid when it subscribes.
    expect(terminalFirstAttachGrid(environmentA, input)).toEqual({ cols: 90, rows: 30 });
    unmount();

    // A remount at another size asks for the same attach, not a second stream.
    const remount = mountSession(input);
    reportTerminalViewportGrid(environmentA, input, { cols: 120, rows: 40 });
    expect(attachCalls.length).toBeGreaterThan(0);
    expect(attachCalls).toEqual(attachCalls.map(() => ({ environmentId: environmentA, input })));
    remount();
  });

  it("lets a launch open the shell at the viewport's grid before the viewport attaches", async () => {
    attachCalls.length = 0;
    const input = launchInput("terminal-2");
    const spawn = holdTerminalSpawn(environmentA, input, 60_000);
    const unmount = mountSession(input);
    reportTerminalViewportGrid(environmentA, input, { cols: 48, rows: 20 });

    await expect(spawn.grid).resolves.toEqual({ cols: 48, rows: 20 });
    expect(attachCalls).toEqual([]);
    spawn.release();
    expect(attachCalls).toEqual([{ environmentId: environmentA, input }]);
    unmount();
  });

  it("gives up on the grid after the timeout, so the launch opens at the default size", async () => {
    vi.useFakeTimers();
    try {
      const input = launchInput("terminal-3");
      const spawn = holdTerminalSpawn(environmentA, input, 2_000);
      vi.advanceTimersByTime(2_000);
      await expect(spawn.grid).resolves.toBeNull();
      spawn.release();
    } finally {
      vi.useRealTimers();
    }
  });
});
