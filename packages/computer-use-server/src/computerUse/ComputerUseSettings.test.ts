import * as NodeAssert from "node:assert/strict";
import { ComputerUseSettings } from "@t3tools/computer-use-contracts";
import * as Schema from "effect/Schema";
import { test } from "vite-plus/test";

const decodeSettings = Schema.decodeUnknownSync(ComputerUseSettings);

test("computer use lets agents act without per-action approval by default", () => {
  const settings = decodeSettings({});
  NodeAssert.equal(settings.enabled, true);
  NodeAssert.equal(settings.mode, "control");
  NodeAssert.equal(settings.requireActionApproval, false);
});
