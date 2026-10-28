import { describe, expect, it } from "vite-plus/test";

import { CursorAgentSdkRunnerError } from "./CursorAgentSdk.ts";
import { cursorRunFailure, cursorSdkErrorReason } from "./runFailure.ts";
import { CursorSdkError } from "./sdk.ts";

// The SDK joins Cursor's ErrorDetails title and detail with a space.
const usageLimitMessage =
  "You've hit your usage limit You've saved $42 on API model usage this month with Pro. Switch to Auto for more requests or set a Spend Limit to continue with Claude. Your usage limits will reset when your monthly cycle ends on 11/14/2026.";

describe("cursorRunFailure", () => {
  it("names the model and keeps Cursor's detail for a local usage limit without a code", () => {
    expect(
      cursorRunFailure({
        reason: { message: usageLimitMessage },
        model: "claude-opus-5-5",
        class: "provider_error",
      }),
    ).toEqual({
      class: "usage_limit",
      message:
        "Cursor usage limit reached for claude-opus-5-5. Your usage limits will reset when your monthly cycle ends on 11/14/2026. Switch to another model or provider to keep working now.",
      code: null,
      retryable: null,
      detail: usageLimitMessage,
    });
  });

  it.each([
    { message: "Usage limit for this model", code: "PRO_USER_USAGE_LIMIT" },
    { message: "Free requests used up", code: "FREE_USER_USAGE_LIMIT" },
    { message: "Slow down", code: "RATE_LIMITED" },
    { message: "Enable usage-based pricing to continue", code: "USAGE_PRICING_REQUIRED" },
    { message: "[resource_exhausted] Rate limited during API key exchange.", code: undefined },
  ])("recognizes the limit from Cursor's code or text: $code", (reason) => {
    const failure = cursorRunFailure({ reason, model: "gpt-6-sol", class: "provider_error" });
    expect(failure.class).toBe("usage_limit");
    expect(failure.message).toMatch(/^Cursor usage limit reached for gpt-6-sol\./);
    expect(failure.message).toContain("Switch to another model or provider");
    expect(failure.message).not.toContain("[resource_exhausted]");
    expect(failure.detail).toBe(reason.message);
    expect(failure.code).toBe(reason.code ?? null);
  });

  it("omits the model name for Auto", () => {
    expect(
      cursorRunFailure({
        reason: { message: "", code: "PRO_USER_RATE_LIMIT_EXCEEDED" },
        model: "auto",
        class: "provider_error",
      }).message,
    ).toBe("Cursor usage limit reached. Switch to another model or provider to keep working now.");
  });

  it("passes other Cursor reasons through and falls back only without one", () => {
    expect(
      cursorRunFailure({
        reason: { message: "Model not available for your plan", code: "BAD_MODEL_NAME" },
        model: "composer-2.5",
        class: "provider_error",
      }),
    ).toEqual({
      class: "provider_error",
      message:
        "Cursor reported an error: Model not available for your plan. Send the message again.",
      code: "BAD_MODEL_NAME",
      retryable: null,
      detail: "Model not available for your plan",
    });
    expect(
      cursorRunFailure({ reason: undefined, model: "composer-2.5", class: "provider_error" })
        .message,
    ).toBe(
      "Cursor stopped with an error it didn't explain. Send the message again; if it repeats, check Cursor in Settings.",
    );
  });

  it("reads a transport dump as Cursor being unreachable", () => {
    const failure = cursorRunFailure({
      reason: { message: "Error: ConnectError: [unavailable] upstream connect error" },
      model: "composer-2.5",
      class: "transport_error",
    });
    expect(failure.message).toBe(
      "Cursor's servers didn't respond (upstream connect error). Check your connection and send again.",
    );
    expect(failure.detail).toBe("Error: ConnectError: [unavailable] upstream connect error");
  });
});

describe("cursorSdkErrorReason", () => {
  it("reads the SDK error under the runner wrapper", () => {
    const sdkError = new CursorSdkError("You've hit your usage limit", {
      code: "PRO_USER_USAGE_LIMIT",
    });
    expect(
      cursorSdkErrorReason(new CursorAgentSdkRunnerError({ method: "run.wait", cause: sdkError })),
    ).toEqual({ message: "You've hit your usage limit", code: "PRO_USER_USAGE_LIMIT" });
  });

  it("does not expose arbitrary defects", () => {
    expect(
      cursorSdkErrorReason(
        new CursorAgentSdkRunnerError({ method: "run.wait", cause: new Error("private defect") }),
      ),
    ).toBeUndefined();
  });
});
