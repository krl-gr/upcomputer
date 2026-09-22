import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { migrateProjectConfig } from "./ProjectConfigMigration.ts";

it.layer(NodeServices.layer)("project config migration", (it) => {
  it.effect("requires consent, preserves JSONC bytes, and is repeatable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "upcomputer-config-test-" });
      const raw =
        '{ // retained comment\n "scripts": [{"name":"Dev", "command":"echo fixture"}],\n}';
      yield* fs.writeFileString(path.join(root, "t3.json"), raw);
      expect(yield* migrateProjectConfig(root, false)).toBe("confirmation-required");
      expect(yield* fs.exists(path.join(root, "upcomputer.json"))).toBe(false);
      expect(yield* migrateProjectConfig(root, true)).toBe("migrated");
      expect(yield* fs.readFileString(path.join(root, "upcomputer.json"))).toBe(raw);
      expect(yield* fs.readFileString(path.join(root, "t3.json"))).toBe(raw);
      expect(yield* migrateProjectConfig(root, true)).toBe("already-current");
      expect((yield* fs.readDirectory(root)).sort()).toEqual(["t3.json", "upcomputer.json"]);
    }),
  );
  it.effect("does not copy symlink targets into a project", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "upcomputer-config-test-" });
      const target = path.join(root, "unrelated.json");
      yield* fs.writeFileString(target, "{}");
      yield* fs.symlink(target, path.join(root, "t3.json"));
      expect((yield* Effect.exit(migrateProjectConfig(root, true)))._tag).toBe("Failure");
      expect(yield* fs.exists(path.join(root, "upcomputer.json"))).toBe(false);
    }),
  );
  it.effect("does not overwrite conflicts or publish invalid input", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "upcomputer-config-test-" });
      yield* fs.writeFileString(path.join(root, "t3.json"), "invalid");
      expect((yield* Effect.exit(migrateProjectConfig(root, true)))._tag).toBe("Failure");
      expect(yield* fs.exists(path.join(root, "upcomputer.json"))).toBe(false);
      yield* fs.writeFileString(path.join(root, "upcomputer.json"), "{}");
      expect((yield* Effect.exit(migrateProjectConfig(root, true)))._tag).toBe("Failure");
      expect(yield* fs.readFileString(path.join(root, "upcomputer.json"))).toBe("{}");
    }),
  );
});
