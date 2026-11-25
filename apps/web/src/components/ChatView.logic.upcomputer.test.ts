import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import { getLocalStorageItem } from "../hooks/useLocalStorage";
import { rememberCheckoutIsRepo, threadErrorBannerRepeatsFailureCard } from "./ChatView.logic";

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

describe("thread error banner over a failed turn", () => {
  const signedOut = "Claude Code isn't signed in. Sign in from Settings.";

  it("stays hidden when the timeline's failure card already says it", () => {
    // The banner covered the user's message with the card's own text (QA .771 bug 4).
    expect(
      threadErrorBannerRepeatsFailureCard({
        error: signedOut,
        runtimeError: signedOut,
        runtimeErrorClass: "permission_error",
      }),
    ).toBe(true);
  });

  it("shows errors the timeline has no card for", () => {
    expect(
      threadErrorBannerRepeatsFailureCard({
        error: "Session crashed.",
        runtimeError: "Session crashed.",
        runtimeErrorClass: null,
      }),
    ).toBe(false);
    expect(
      threadErrorBannerRepeatsFailureCard({
        error: "Couldn't send the message.",
        runtimeError: signedOut,
        runtimeErrorClass: "permission_error",
      }),
    ).toBe(false);
  });
});
