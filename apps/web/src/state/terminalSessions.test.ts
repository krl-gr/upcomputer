import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type TerminalSummary } from "@t3tools/contracts";
import { selectRunningSubprocessTerminalIds } from "@t3tools/client-runtime/state/terminal";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  attachedTerminalSessionAtom,
  holdTerminalSpawn,
  knownTerminalSessionsAtom,
  reportTerminalViewportGrid,
  selectKnownTerminalSessions,
} from "./terminalSessions";

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
const threadB = ThreadId.make("thread-b");

function summary(
  threadId: string,
  terminalId: string,
  changes: Partial<TerminalSummary> = {},
): TerminalSummary {
  return {
    threadId,
    terminalId,
    cwd: "/repo",
    worktreePath: null,
    status: "running",
    pid: 123,
    exitCode: null,
    exitSignal: null,
    hasRunningSubprocess: true,
    label: "Terminal",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...changes,
  };
}

describe("selectKnownTerminalSessions", () => {
  it("changes only the affected group and preserves earlier snapshots", () => {
    const first = summary(threadA, "terminal-1");
    const second = summary(threadA, "terminal-2");
    const other = summary(threadB, "terminal-1");
    const metadata = [first, second, other];
    const beforeA = selectKnownTerminalSessions(metadata, environmentA, threadA);
    const beforeB = selectKnownTerminalSessions(metadata, environmentA, threadB);
    Object.freeze(beforeA);
    Object.freeze(beforeB);
    const exited = {
      ...second,
      status: "exited" as const,
      pid: null,
      exitCode: 0,
      hasRunningSubprocess: false,
      label: "Finished",
      updatedAt: "2026-09-04T00:00:01.000Z",
    };
    const next = [first, other, exited];
    const afterA = selectKnownTerminalSessions(next, environmentA, threadA);
    expect(selectKnownTerminalSessions(next, environmentA, threadB)).toBe(beforeB);
    expect(afterA).not.toBe(beforeA);
    expect(afterA[0]).toBe(beforeA[0]);
    expect(afterA[1]?.state).toMatchObject({
      status: "exited",
      hasRunningSubprocess: false,
      summary: { label: "Finished", pid: null, exitCode: 0 },
    });
    expect(selectRunningSubprocessTerminalIds(afterA)).toEqual(["terminal-1"]);
    expect(beforeA[1]?.state).toMatchObject({
      status: "running",
      hasRunningSubprocess: true,
      summary: { label: "Terminal", pid: 123 },
    });
    expect(selectKnownTerminalSessions(metadata, environmentA, threadA)).toBe(beforeA);

    const renamed = [first, exited, { ...other, label: "Renamed" }];
    expect(selectKnownTerminalSessions(renamed, environmentA, threadA)).toBe(afterA);
    expect(
      selectKnownTerminalSessions(renamed, environmentA, threadB)[0]?.state.summary?.label,
    ).toBe("Renamed");
    expect(selectKnownTerminalSessions([other], environmentA, threadA)).toEqual([]);
    expect(selectKnownTerminalSessions([other], environmentA, threadB)).toBe(beforeB);
  });
});

describe("knownTerminalSessionsAtom", () => {
  const metadataResult = (...terminals: ReadonlyArray<TerminalSummary>) =>
    AsyncResult.success<ReadonlyArray<TerminalSummary>>(terminals);

  it("notifies only when the thread's own terminals change", () => {
    const registry = AtomRegistry.make();
    const sessions = knownTerminalSessionsAtom(environmentA, threadA);
    expect(registry.get(sessions)).toBeNull();

    const first = summary(threadA, "terminal-1");
    const other = summary(threadB, "terminal-1");
    registry.set(metadataAtom, metadataResult(first));
    const notified: unknown[] = [];
    const unsubscribe = registry.subscribe(sessions, (value) => notified.push(value));
    const before = registry.get(sessions);

    registry.set(metadataAtom, metadataResult(first, other));
    registry.set(metadataAtom, metadataResult(first, { ...other, label: "Renamed" }));
    expect(notified).toEqual([]);
    expect(registry.get(sessions)).toBe(before);

    registry.set(metadataAtom, metadataResult({ ...first, label: "Renamed" }, other));
    expect(notified).toHaveLength(1);

    const previousSuccess = Option.some(metadataResult(first));
    registry.set(metadataAtom, AsyncResult.failure(Cause.die("unavailable"), { previousSuccess }));
    expect(registry.get(sessions)).toBeNull();
    unsubscribe();
  });
});

describe("attachedTerminalSessionAtom", () => {
  const launchInput = (terminalId: string) => ({
    threadId: threadA,
    terminalId,
    cwd: "/repo",
    worktreePath: null,
    env: { T3CODE_PROJECT_ROOT: "/repo" },
  });

  it("attaches with the launch input it was keyed by, at the viewport's first grid", () => {
    attachCalls.length = 0;
    const input = launchInput("terminal-1");
    const atom = attachedTerminalSessionAtom(environmentA, input);
    expect(attachedTerminalSessionAtom(environmentA, { ...input })).toBe(atom);

    const unsubscribe = appAtomRegistry.subscribe(atom, () => undefined, { immediate: true });
    // The shell would start at the server's default size, so attaching waits for a grid.
    expect(attachCalls).toEqual([]);
    reportTerminalViewportGrid(environmentA, input, { cols: 48, rows: 20 });
    // Later grids reach the PTY as resizes; the attach keeps its first one.
    reportTerminalViewportGrid(environmentA, input, { cols: 90, rows: 30 });
    expect(attachCalls).toEqual([
      { environmentId: environmentA, input: { ...input, cols: 48, rows: 20 } },
    ]);
    unsubscribe();
  });

  it("lets a launch open the shell at the viewport's grid before the viewport attaches", async () => {
    attachCalls.length = 0;
    const input = launchInput("terminal-2");
    const spawn = holdTerminalSpawn(environmentA, input, 60_000);
    const unsubscribe = appAtomRegistry.subscribe(
      attachedTerminalSessionAtom(environmentA, input),
      () => undefined,
      { immediate: true },
    );
    reportTerminalViewportGrid(environmentA, input, { cols: 48, rows: 20 });

    await expect(spawn.grid).resolves.toEqual({ cols: 48, rows: 20 });
    expect(attachCalls).toEqual([]);
    spawn.release();
    expect(attachCalls).toEqual([
      { environmentId: environmentA, input: { ...input, cols: 48, rows: 20 } },
    ]);
    unsubscribe();
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
