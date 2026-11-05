// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - a synchronous wrapper around one vitest project.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const webRoot = NodePath.join(root, "apps/web");
const sheetDirectory = NodePath.join(webRoot, "src/uiStates");
const outputDirectory = NodePath.join(root, ".ui-states");
const SHEET_SUFFIX = ".states.tsx";

const HELP = `Usage: vp run ui-states [sheet]

Renders UI state sheets (apps/web/src/uiStates/<sheet>${SHEET_SUFFIX}) in headless
Chromium with the app's CSS and theme, and writes <sheet>-dark.png and
<sheet>-light.png to .ui-states/. Without a sheet it renders every sheet.`;

const sheets = NodeFS.readdirSync(sheetDirectory)
  .filter((file) => file.endsWith(SHEET_SUFFIX))
  .map((file) => file.slice(0, -SHEET_SUFFIX.length))
  .toSorted();

const requested = process.argv.slice(2).filter((argument) => argument !== "--");
if (requested.includes("--help") || requested.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const unknown = requested.filter((sheet) => !sheets.includes(sheet));
if (unknown.length > 0) {
  console.error(`Unknown sheet: ${unknown.join(", ")}. Sheets: ${sheets.join(", ")}`);
  process.exit(1);
}
const selected = requested.length > 0 ? requested : sheets;

NodeFS.mkdirSync(outputDirectory, { recursive: true });
const result = NodeChildProcess.spawnSync(
  "vp",
  [
    "test",
    "run",
    "--project",
    "ui-states",
    ...selected.map((sheet) => `src/uiStates/${sheet}${SHEET_SUFFIX}`),
  ],
  {
    cwd: webRoot,
    env: { ...process.env, T3CODE_UI_STATES_DIR: outputDirectory },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
if (result.status !== 0) {
  console.error(`ui-states failed (exit ${result.status ?? result.signal})`);
  process.exit(1);
}
for (const sheet of selected) {
  for (const theme of ["dark", "light"]) {
    console.log(NodePath.join(outputDirectory, `${sheet}-${theme}.png`));
  }
}
