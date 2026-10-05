// @effect-diagnostics nodeBuiltinImport:off - Runs at module load, before the Effect runtime exists.
// Side-effect module: `main.ts` imports it first. See UpcomputerStartupEnvironment.ts.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Electron from "electron";

import { applyUpcomputerStartupEnvironment } from "./UpcomputerStartupEnvironment.ts";

applyUpcomputerStartupEnvironment({
  env: process.env,
  appVersion: Electron.app.getVersion(),
  homeDirectory: NodeOS.homedir(),
  joinPath: NodePath.join,
});
