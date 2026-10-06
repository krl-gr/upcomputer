// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { onTestFinished, test } from "vite-plus/test";

import { ComputerUseSettings } from "@t3tools/computer-use-contracts";
import { ServerSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  computerUseSettingsPath,
  moveLegacySettingsSections,
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

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeComputerUseSettings = Schema.decodeUnknownSync(ComputerUseSettings);

/** What core's settings save leaves of settings.json: only the keys its schema knows. */
function saveAsCore(settingsPath: string) {
  const decoded = decodeServerSettings(JSON.parse(NodeFS.readFileSync(settingsPath, "utf8")));
  NodeFS.writeFileSync(settingsPath, JSON.stringify(encodeServerSettings(decoded)));
}

test("V1 restrictions moved on start survive core's next settings save", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "computer-use-settings-"));
  onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  const settingsPath = NodePath.join(directory, "settings.json");
  const restricted = {
    enabled: false,
    mode: "observe",
    requireActionApproval: true,
    allowedApps: ["Notes"],
  };
  NodeFS.writeFileSync(
    settingsPath,
    JSON.stringify({ customInstructions: "Be brief.", computerUse: restricted }),
  );

  NodeAssert.deepEqual(moveLegacySettingsSections(settingsPath, { replace: false }), [
    "computerUse",
  ]);
  saveAsCore(settingsPath);
  NodeAssert.equal(JSON.parse(NodeFS.readFileSync(settingsPath, "utf8")).computerUse, undefined);

  const { computerUse } = await readSettingsSections(settingsPath);
  const settings = decodeComputerUseSettings(computerUse ?? {});
  NodeAssert.equal(settings.enabled, false);
  NodeAssert.equal(settings.mode, "observe");
  NodeAssert.equal(settings.requireActionApproval, true);
  NodeAssert.deepEqual(settings.allowedApps, ["Notes"]);

  // On a normal start the own file wins; right after a V1 cutover, V1's sections do.
  NodeFS.writeFileSync(settingsPath, JSON.stringify({ computerUse: { enabled: true } }));
  NodeAssert.deepEqual(moveLegacySettingsSections(settingsPath, { replace: false }), []);
  NodeAssert.deepEqual((await readSettingsSections(settingsPath)).computerUse, restricted);
  NodeAssert.deepEqual(moveLegacySettingsSections(settingsPath, { replace: true }), [
    "computerUse",
  ]);
  NodeAssert.deepEqual((await readSettingsSections(settingsPath)).computerUse, { enabled: true });
  NodeAssert.deepEqual(NodeFS.readdirSync(directory).toSorted(), [
    "computer-use.json",
    "settings.json",
  ]);
});
