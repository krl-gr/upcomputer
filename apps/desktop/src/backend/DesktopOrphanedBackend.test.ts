// @effect-diagnostics nodeBuiltinImport:off - Spawns one throwaway child and writes its runtime record.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { findOrphanedBackend, stopOrphanedBackend } from "./DesktopOrphanedBackend.ts";

const withLeftoverServer = <A>(
  record: (pid: number) => Record<string, unknown>,
  use: (stateDir: string, pid: number) => Effect.Effect<A>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "orphaned-backend-"));
      const child = NodeChildProcess.spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        {
          stdio: "ignore",
        },
      );
      NodeFS.writeFileSync(
        NodePath.join(stateDir, "server-runtime.json"),
        JSON.stringify(record(child.pid!)),
      );
      return { stateDir, child };
    }),
    ({ stateDir, child }) => use(stateDir, child.pid!),
    ({ stateDir, child }) =>
      Effect.sync(() => {
        child.kill("SIGKILL");
        NodeFS.rmSync(stateDir, { recursive: true, force: true });
      }),
  );

it.live.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "finds and stops only this app's own leftover server",
  () =>
    withLeftoverServer(
      (pid) => ({ version: 1, pid, port: 1, origin: "http://127.0.0.1:1", startedAt: "" }),
      (stateDir, pid) =>
        Effect.gen(function* () {
          assert.isNull(yield* findOrphanedBackend(stateDir, "/Applications/Other.app/Other"));
          assert.strictEqual(yield* findOrphanedBackend(stateDir, process.execPath), pid);
          assert.isTrue(yield* stopOrphanedBackend(pid));
          assert.isNull(yield* findOrphanedBackend(stateDir, process.execPath));
        }),
    ),
);

it.live.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "never offers to stop the background service",
  () =>
    withLeftoverServer(
      (pid) => ({ version: 1, pid, serviceManaged: true }),
      (stateDir) =>
        Effect.gen(function* () {
          assert.isNull(yield* findOrphanedBackend(stateDir, process.execPath));
        }),
    ),
);
