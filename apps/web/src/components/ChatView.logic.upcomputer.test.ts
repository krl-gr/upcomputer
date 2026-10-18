import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import { getLocalStorageItem } from "../hooks/useLocalStorage";
import { rememberCheckoutIsRepo } from "./ChatView.logic";

vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => "upcomputer",
}));

describe("checkout Git memory on UpComputer's surface", () => {
  it("keeps what it saw for the next launch", () => {
    // Without it, a relaunch into a folder without Git mounted the branch strip
    // ("Current checkout | Select ref") and dropped it a moment later.
    const environmentId = EnvironmentId.make("env-upcomputer");
    rememberCheckoutIsRepo(environmentId, "/repo/persisted-folder", false);
    const persisted = getLocalStorageItem(
      "upcomputer:checkout-is-repo:v1",
      Schema.Record(Schema.String, Schema.Boolean),
    );
    expect(persisted?.[JSON.stringify([environmentId, "/repo/persisted-folder"])]).toBe(false);
  });
});
