// @effect-diagnostics nodeBuiltinImport:off - Native startup fixtures exercise the pre-Effect filesystem boundary using disposable profiles.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { migrateProfile, profileMigrationDirectory } from "@upcomputer/shared/profileMigration";
import { resolveBaseDir } from "./os-jank.ts";

const state = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async () => ({
  ...(await vi.importActual<typeof import("node:os")>("node:os")),
  homedir: () => state.home,
}));

it.effect(
  "blocks backend root resolution before a partial migration can create/open a database",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.acquireRelease(
        Effect.promise(async () =>
          NodeFSP.realpath(
            await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "upcomputer-profile-startup-")),
          ),
        ),
        (home) =>
          Effect.promise(async () => {
            await NodeFSP.rm(home, { recursive: true, force: true });
            state.home = "";
          }),
      );
      state.home = home;
      const source = NodePath.join(home, ".t3"),
        destination = NodePath.join(home, ".upcomputer");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(source);
        await NodeFSP.writeFile(NodePath.join(source, "fixture"), "synthetic");
      });
      const plan = {
        directory: profileMigrationDirectory(home),
        roots: [{ id: "backend" as const, source, destination }],
      };
      const adapter = {
        acquireOfflineLease: async () => ({ assertHeld: async () => {}, release: async () => {} }),
        prepare: async () => {},
        validate: async () => {},
      };
      yield* Effect.promise(() =>
        expect(
          migrateProfile(plan, {
            adapter,
            checkpoint: async (phase) => {
              if (phase === "prepared") throw new Error("fixture stop");
            },
          }),
        ).rejects.toThrow(),
      );
      const resolve = (raw?: string) =>
        resolveBaseDir(raw).pipe(Effect.provide(NodeServices.layer));
      expect(yield* Effect.flip(resolve())).toMatchObject({ code: "startup-check-failed" });
      expect(yield* Effect.flip(resolve(source))).toMatchObject({ code: "startup-check-failed" });
      yield* Effect.promise(() =>
        expect(NodeFSP.stat(destination)).rejects.toMatchObject({ code: "ENOENT" }),
      );
      yield* Effect.promise(() => migrateProfile(plan, { adapter }));
      expect(yield* resolve()).toBe(destination);
      expect(yield* resolve(source)).toBe(destination);
    }).pipe(Effect.scoped),
);
