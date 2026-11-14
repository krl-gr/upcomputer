import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { clearStaleGpuCaches, resolveUserDataPath } from "./DesktopUserData.ts";

// Up.computer keeps V1's Electron profile folders so an auto-updated V1
// install keeps its sign-ins, safeStorage keys and browser profiles.
it.effect.each([
  { appVersion: "0.0.45", isDevelopment: false, expected: "Up.computer" },
  { appVersion: "0.0.45", isDevelopment: true, expected: "Up.computer (Dev)" },
  { appVersion: "0.0.45-nightly.20261005.1", isDevelopment: false, expected: "Up.computer" },
  { appVersion: "0.0.45-localtest.1", isDevelopment: false, expected: "UpComputer Local Test" },
  { appVersion: "0.0.45-demo.1", isDevelopment: false, expected: "Up.computer Demo" },
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
    yield* fs.writeFileString(path.join(directory, "t3code", "Local State"), "Up.computer keys");
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
    for (const other of ["t3code", "Up.computer (Alpha)", "t3code-v2"]) {
      yield* fs.makeDirectory(path.join(directory, other), { recursive: true });
      yield* fs.writeFileString(path.join(directory, other, "Local State"), "Up.computer keys");
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

const gpuCacheDirectories = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

it.effect.each([
  { profile: "written by Electron 44.10.0", marker: "44.10.0" },
  { profile: "with no recorded Electron version", marker: undefined },
])("clears GPU caches $profile once when Electron 44.10.1 starts", ({ marker }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-gpu-cache-" });
    for (const name of gpuCacheDirectories) {
      yield* fs.makeDirectory(path.join(userDataPath, name), { recursive: true });
      yield* fs.writeFileString(path.join(userDataPath, name, "data_0"), "44.10.0 shaders");
    }
    yield* fs.makeDirectory(path.join(userDataPath, "Local Storage"), { recursive: true });
    yield* fs.writeFileString(path.join(userDataPath, "Local Storage", "LOCK"), "profile");
    yield* fs.writeFileString(path.join(userDataPath, "Local State"), "profile");
    if (marker !== undefined) {
      yield* fs.writeFileString(path.join(userDataPath, "gpu-cache-electron-version"), marker);
    }

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    const survivingCaches: Array<string> = [];
    for (const name of gpuCacheDirectories) {
      if (yield* fs.exists(path.join(userDataPath, name))) survivingCaches.push(name);
    }
    assert.deepStrictEqual(survivingCaches, []);
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "Local Storage", "LOCK")),
      "profile",
    );
    assert.equal(yield* fs.readFileString(path.join(userDataPath, "Local State")), "profile");

    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps GPU caches built on the first launch of a fresh install", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appData = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-fresh-" });
    const userDataPath = path.join(appData, "t3code-v2");

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("retries on the next launch when a GPU cache cannot be removed", () =>
  Effect.gen(function* () {
    const writes: Array<string> = [];
    const fileSystem = FileSystem.makeNoop({
      remove: (path) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "remove",
            pathOrDescriptor: path,
          }),
        ),
      writeFileString: (path) =>
        Effect.sync(() => {
          writes.push(path);
        }),
    });

    yield* clearStaleGpuCaches({ userDataPath: "/profile", electronVersion: "44.10.1" }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

    assert.deepStrictEqual(writes, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);
