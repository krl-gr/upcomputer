import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NodeOS from "node:os";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import { resolveBaseDir } from "./os-jank.ts";

describe("independent profile paths", () => {
  it.effect("never probes or adopts an old profile for the default path", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      for (const input of [undefined, "", "   "]) {
        assert.equal(yield* resolveBaseDir(input), path.join(NodeOS.homedir(), ".upcomputer"));
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          FileSystem.layerNoop({ exists: () => Effect.die("Unexpected profile discovery") }),
        ),
      ),
    ),
  );
  it.effect("still honors an explicitly selected directory", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(
        yield* resolveBaseDir(" /tmp/upcomputer-explicit "),
        path.resolve("/tmp/upcomputer-explicit"),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
