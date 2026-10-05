// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { onTestFinished, test } from "vite-plus/test";

import {
  computerUseSettingsPath,
  readSettingsSections,
  updateSettingsSection,
} from "./ComputerUseSettingsFile.ts";

test("saving one section starts from V1's settings.json and never touches it", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "computer-use-settings-"));
  onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  const settingsPath = NodePath.join(directory, "settings.json");
  const legacy = JSON.stringify({
    theme: "dark",
    browser: { alwaysUseChrome: true },
    computerUse: { mode: "observe" },
  });
  NodeFS.writeFileSync(settingsPath, legacy);

  NodeAssert.deepEqual(await readSettingsSections(settingsPath), {
    browser: { alwaysUseChrome: true },
    computerUse: { mode: "observe" },
  });
  await Promise.all([
    updateSettingsSection(settingsPath, "computerUse", { mode: "control" }),
    updateSettingsSection(settingsPath, "browser", { alwaysUseChrome: false }),
  ]);

  NodeAssert.deepEqual(
    JSON.parse(NodeFS.readFileSync(computerUseSettingsPath(settingsPath), "utf8")),
    {
      browser: { alwaysUseChrome: false },
      computerUse: { mode: "control" },
    },
  );
  NodeAssert.equal(NodeFS.readFileSync(settingsPath, "utf8"), legacy);
  // Once the own file exists, core rewriting settings.json without these keys loses nothing.
  NodeFS.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
  NodeAssert.deepEqual(await readSettingsSections(settingsPath), {
    browser: { alwaysUseChrome: false },
    computerUse: { mode: "control" },
  });
});
