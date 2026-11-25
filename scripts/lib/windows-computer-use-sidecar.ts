import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { BuildArch } from "./build-target-arch.ts";

export class WindowsComputerUseSidecarMissingError extends Schema.TaggedError<WindowsComputerUseSidecarMissingError>()(
  "WindowsComputerUseSidecarMissingError",
  { packagedAppDir: Schema.String, expectedPath: Schema.String },
) {
  override get message() {
    return `Windows packaged payload has no unpacked computer use executable at resources/${this.expectedPath}. The server spawns it from there, so computer use would fail with ENOENT.`;
  }
}

/** The server.asar entry of open-computer-use's Windows executable, as asar headers name it. */
export function windowsComputerUseSidecarEntry(arch: BuildArch): string {
  return `node_modules/open-computer-use/dist/windows/${arch === "arm64" ? "arm64" : "amd64"}/open-computer-use.exe`;
}

export const verifyWindowsComputerUseSidecar = Effect.fn("verifyWindowsComputerUseSidecar")(
  function* (input: {
    readonly packagedAppDir: string;
    readonly unpackedFiles: ReadonlyArray<string>;
    readonly targetArch: BuildArch;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entry = windowsComputerUseSidecarEntry(input.targetArch);
    const expectedPath = `server.asar.unpacked/${entry}`;
    const executable = path.join(input.packagedAppDir, "resources", ...expectedPath.split("/"));
    const isFile = yield* fs.stat(executable).pipe(
      Effect.map((stat) => stat.type === "File"),
      Effect.orElseSucceed(() => false),
    );
    if (!input.unpackedFiles.includes(entry) || !isFile) {
      return yield* new WindowsComputerUseSidecarMissingError({
        packagedAppDir: input.packagedAppDir,
        expectedPath,
      });
    }
  },
);
