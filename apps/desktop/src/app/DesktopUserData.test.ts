import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

// Up.computer keeps V1's Electron profile folders so an auto-updated V1
// install keeps its sign-ins, safeStorage keys and browser profiles.
it.effect.each([
  { appVersion: "0.0.45", isDevelopment: false, expected: "Up.computer" },
  { appVersion: "0.0.45", isDevelopment: true, expected: "Up.computer (Dev)" },
  { appVersion: "0.0.45-nightly.20261005.1", isDevelopment: false, expected: "Up.computer" },
  { appVersion: "0.0.45-localtest.1", isDevelopment: false, expected: "UpComputer Local Test" },
])("uses the V1 profile folder $expected", ({ appVersion, isDevelopment, expected }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "upc-profile-" });
    for (const platform of ["darwin", "win32", "linux"] as const) {
      assert.equal(
        yield* resolveUserDataPath({
          appDataDirectory: directory,
          appVersion,
          isDevelopment,
          platform,
        }),
        path.join(directory, expected),
      );
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps an existing V1 Windows profile in place", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "upc-profile-" });
    const profile = path.join(directory, "Up.computer");
    const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
    yield* fs.makeDirectory(path.join(directory, "t3code"), { recursive: true });
    yield* fs.writeFileString(path.join(directory, "t3code", "Local State"), "T3 Code keys");
    yield* fs.makeDirectory(profile, { recursive: true });
    yield* fs.writeFileString(path.join(profile, "Local State"), state);

    const resolved = yield* resolveUserDataPath({
      appDataDirectory: directory,
      appVersion: "0.0.45",
      isDevelopment: false,
      platform: "win32",
    });

    assert.equal(resolved, profile);
    assert.equal(yield* fs.readFileString(path.join(profile, "Local State")), state);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("never copies another app's Windows credential keys into a new profile", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "upc-profile-" });
    for (const other of ["t3code", "T3 Code (Alpha)", "t3code-v2"]) {
      yield* fs.makeDirectory(path.join(directory, other), { recursive: true });
      yield* fs.writeFileString(path.join(directory, other, "Local State"), "T3 Code keys");
    }

    const resolved = yield* resolveUserDataPath({
      appDataDirectory: directory,
      appVersion: "0.0.45",
      isDevelopment: false,
      platform: "win32",
    });

    assert.equal(resolved, path.join(directory, "Up.computer"));
    assert.isFalse(yield* fs.exists(path.join(resolved, "Local State")));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
