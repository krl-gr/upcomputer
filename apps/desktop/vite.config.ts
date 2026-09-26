import { readUpcomputerEnvironment } from "@upcomputer/shared/environmentNames";
import { defineConfig } from "vite-plus";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

const repoEnv = loadRepoEnv();
const shouldLaunchElectronAfterPack =
  readUpcomputerEnvironment(process.env, "UPCOMPUTER_DESKTOP_DEV") === "1";
const desktopSourcemapEnv = readUpcomputerEnvironment(process.env, "UPCOMPUTER_DESKTOP_SOURCEMAP")
  ?.trim()
  .toLowerCase();
const shouldGenerateDesktopSourcemaps =
  desktopSourcemapEnv !== "0" && desktopSourcemapEnv !== "false";
const publicConfigDefine = {
  __UPCOMPUTER_BUILD_CLERK_PUBLISHABLE_KEY__: JSON.stringify(
    repoEnv.UPCOMPUTER_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
  ),
};

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack",
        dependsOn: ["@upcomputer/server#build"],
        cache: false,
      },
      dev: {
        command:
          "node scripts/build-preview-annotation-css.mjs && cross-env UPCOMPUTER_DESKTOP_DEV=1 vp pack --watch",
        dependsOn: ["@upcomputer/server#build"],
        cache: false,
      },
      "dev:bundle": {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack --watch",
        cache: false,
      },
      "dev:electron": {
        command: "node scripts/dev-electron.mjs",
        dependsOn: ["@upcomputer/server#build"],
        cache: false,
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: shouldGenerateDesktopSourcemaps,
      outExtensions: () => ({ js: ".cjs" }),
      define: publicConfigDefine,
      entry: ["src/main.ts"],
      clean: true,
      deps: {
        alwaysBundle: (id) => id.startsWith("@upcomputer/"),
      },
      ...(shouldLaunchElectronAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: shouldGenerateDesktopSourcemaps,
      outExtensions: () => ({ js: ".cjs" }),
      define: publicConfigDefine,
      entry: ["src/preload.ts"],
      deps: {
        // Sandboxed Electron preloads cannot reliably resolve package imports
        // from inside the packaged ASAR. Bundle Clerk's preload bridge into the
        // preload artifact instead of leaving a runtime require() behind.
        alwaysBundle: (id) => id === "@clerk/electron" || id.startsWith("@clerk/electron/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: shouldGenerateDesktopSourcemaps,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-pick-preload.ts"],
      deps: {
        alwaysBundle: (id) => id === "react-grab" || id.startsWith("react-grab/"),
      },
    },
  ],
});
