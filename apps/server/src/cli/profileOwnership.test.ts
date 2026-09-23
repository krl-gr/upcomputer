// @effect-diagnostics nodeBuiltinImport:off - Disposable native gate fixture, outside application storage.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  acquireProfileOwnership,
  profileOwnershipDirectory,
} from "@upcomputer/shared/profileOwnership";
import { acquireCliProfileOwnership } from "./profileOwnership.ts";
const state = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async () => ({
  ...(await vi.importActual<typeof import("node:os")>("node:os")),
  homedir: () => state.home,
}));
it.effect("CLI scope retains the kernel lock and releases it on failed commands", () =>
  Effect.gen(function* () {
    const home = yield* Effect.acquireRelease(
      Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "upcomputer-cli-ownership-")),
      ),
      (home) => Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
    );
    state.home = home;
    yield* Effect.gen(function* () {
      yield* acquireCliProfileOwnership();
      expect(() => acquireProfileOwnership(profileOwnershipDirectory(home), "maintenance")).toThrow(
        "busy",
      );
      return yield* Effect.fail("fixture failure");
    }).pipe(Effect.scoped, Effect.exit);
    const maintenance = yield* Effect.acquireRelease(
      Effect.sync(() => acquireProfileOwnership(profileOwnershipDirectory(home), "maintenance")),
      (lease) => Effect.sync(() => lease.release()),
    );
    maintenance.assertHeld();
    expect(yield* Effect.flip(acquireCliProfileOwnership())).toMatchObject({ code: "busy" });
  }).pipe(Effect.scoped),
);
