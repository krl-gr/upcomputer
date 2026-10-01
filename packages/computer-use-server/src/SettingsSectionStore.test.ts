import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { test } from "vite-plus/test";

import { updateSettingsSection } from "./SettingsSectionStore.ts";

test("settings section updates keep the other settings keys", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "computer-use-settings-"));
  const settingsPath = NodePath.join(directory, "settings.json");
  await NodeFSP.writeFile(
    settingsPath,
    JSON.stringify({ enableAssistantStreaming: true, browser: { alwaysUseChrome: true } }),
  );

  await updateSettingsSection(settingsPath, "computerUse", {
    enabled: true,
    mode: "control",
  });
  const settings = JSON.parse(await NodeFSP.readFile(settingsPath, "utf8")) as Record<
    string,
    unknown
  >;
  NodeAssert.equal(settings.enableAssistantStreaming, true);
  NodeAssert.deepEqual(settings.browser, { alwaysUseChrome: true });
  NodeAssert.deepEqual(settings.computerUse, { enabled: true, mode: "control" });
  await NodeFSP.rm(directory, { recursive: true, force: true });
});
