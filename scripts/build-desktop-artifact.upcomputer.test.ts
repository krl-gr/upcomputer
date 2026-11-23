import * as NodeServices from "@effect/platform-node/NodeServices";
import { getRawHeader, type DirectoryRecord } from "@electron/asar";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { createBuildConfig, packWindowsServerAsar } from "./build-desktop-artifact.ts";
import {
  verifyWindowsComputerUseSidecar,
  WindowsComputerUseSidecarMissingError,
  windowsComputerUseSidecarEntry,
} from "./lib/windows-computer-use-sidecar.ts";

it.layer(NodeServices.layer)("build-desktop-artifact (Up.computer)", (it) => {
  it.effect("Windows builds ship no prepared server bytecode; macOS builds still do", () =>
    Effect.gen(function* () {
      const win = yield* createBuildConfig(
        "win",
        "nsis",
        "1.2.3",
        false,
        false,
        undefined,
        undefined,
      );
      assert.notProperty(win, "afterPack");

      const mac = yield* createBuildConfig(
        "mac",
        "dmg",
        "1.2.3",
        false,
        false,
        undefined,
        undefined,
      );
      assert.match(String(mac.afterPack), /[\\/]scripts[\\/]prepare-server-compile-cache\.cjs$/);
    }).pipe(
      Effect.provideService(HostProcess.Platform, "win32"),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
    ),
  );
});

function unpackedEntries(directory: DirectoryRecord, parent = ""): string[] {
  return Object.entries(directory.files).flatMap(([name, entry]) => {
    const entryPath = parent ? `${parent}/${name}` : name;
    if ("files" in entry) return unpackedEntries(entry, entryPath);
    return entry.unpacked ? [entryPath] : [];
  });
}

/** Packs server.asar into resources/ the way the Windows build stages it. */
const makePackagedApp = Effect.fn("test.makePackagedApp")(function* (input: {
  readonly executables: ReadonlyArray<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-windows-computer-use-test-" });
  const sourceDir = path.join(tempDir, "server");
  for (const file of ["apps/server/dist/bin.mjs", ...input.executables]) {
    yield* fs.makeDirectory(path.dirname(path.join(sourceDir, file)), { recursive: true });
    yield* fs.writeFileString(path.join(sourceDir, file), "MZ");
  }
  const packagedAppDir = path.join(tempDir, "win-unpacked");
  const asarPath = path.join(packagedAppDir, "resources", "server.asar");
  yield* fs.makeDirectory(path.dirname(asarPath), { recursive: true });
  yield* packWindowsServerAsar({ sourceDir, asarPath, arch: "x64" });
  return { packagedAppDir, unpackedFiles: unpackedEntries(getRawHeader(asarPath).header) };
});

it.layer(NodeServices.layer)("verifyWindowsComputerUseSidecar (Up.computer)", (it) => {
  it.effect.each(["x64", "arm64"] as const)(
    "accepts a %s server.asar that unpacked the computer use executable",
    (targetArch) =>
      Effect.scoped(
        Effect.gen(function* () {
          const app = yield* makePackagedApp({
            executables: [windowsComputerUseSidecarEntry(targetArch)],
          });
          yield* verifyWindowsComputerUseSidecar({ ...app, targetArch });
        }),
      ),
  );

  it.effect("rejects a server.asar without the target's computer use executable", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* makePackagedApp({
          executables: [windowsComputerUseSidecarEntry("arm64")],
        });
        const error = yield* verifyWindowsComputerUseSidecar({ ...app, targetArch: "x64" }).pipe(
          Effect.flip,
        );
        assert.instanceOf(error, WindowsComputerUseSidecarMissingError);
        assert.equal(
          error.expectedPath,
          "server.asar.unpacked/node_modules/open-computer-use/dist/windows/amd64/open-computer-use.exe",
        );
      }),
    ),
  );

  it.effect("rejects an executable the archive declares but the unpacked folder lacks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const entry = windowsComputerUseSidecarEntry("x64");
        const app = yield* makePackagedApp({ executables: [entry] });
        yield* fs.remove(path.join(app.packagedAppDir, "resources", "server.asar.unpacked", entry));
        const error = yield* verifyWindowsComputerUseSidecar({ ...app, targetArch: "x64" }).pipe(
          Effect.flip,
        );
        assert.instanceOf(error, WindowsComputerUseSidecarMissingError);
      }),
    ),
  );
});
