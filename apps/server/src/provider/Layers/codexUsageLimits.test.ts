import { describe, expect, it } from "vite-plus/test";

import { codexUsageLimitMessage, mergeCodexRateLimits } from "./codexUsageLimits.ts";

describe("codexUsageLimitMessage", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const atSeconds = Date.parse(at) / 1000;

  it("names the exhausted window and the workspace's missing credits", () => {
    expect(
      codexUsageLimitMessage(
        {
          limitId: "codex",
          rateLimitReachedType: "workspace_owner_credits_depleted",
          primary: { usedPercent: 40, resetsAt: atSeconds + 3_600, windowDurationMins: 300 },
          secondary: {
            usedPercent: 100,
            resetsAt: atSeconds + 5 * 86_400 + 5 * 3_600,
            windowDurationMins: 10_080,
          },
        },
        at,
      ),
    ).toBe(
      "Codex usage limit reached. The weekly limit resets in 5d 5h. The workspace has no credits to continue sooner: ask your workspace owner to add credits, or send the message again once the limit resets.",
    );
  });

  it("points a reached spend cap at the workspace owner", () => {
    expect(
      codexUsageLimitMessage(
        {
          limitId: "codex",
          rateLimitReachedType: "workspace_member_usage_limit_reached",
          primary: {
            usedPercent: 100,
            resetsAt: atSeconds + 3 * 3_600 + 20 * 60,
            windowDurationMins: 300,
          },
        },
        at,
      ),
    ).toBe(
      "Codex usage limit reached. The session limit resets in 3h 20m. The workspace spend limit is reached: ask your workspace owner to raise it, or send the message again once the limit resets.",
    );
  });

  it("names no window when credits run out without one", () => {
    expect(
      codexUsageLimitMessage(
        { limitId: "codex", rateLimitReachedType: "workspace_member_credits_depleted" },
        at,
      ),
    ).toBe(
      "Codex usage limit reached. The workspace has no credits to continue sooner: ask your workspace owner to add credits, or send the message again once the limit resets.",
    );
  });

  it("says only what it knows without a snapshot", () => {
    expect(codexUsageLimitMessage(undefined, at)).toBe(
      "Codex usage limit reached. Send the message again once the limit resets.",
    );
  });
});

describe("mergeCodexRateLimits", () => {
  it("keeps windows an update does not carry", () => {
    const merged = mergeCodexRateLimits(
      {
        limitId: "codex",
        planType: "business",
        primary: { usedPercent: 100, resetsAt: 1_800_000_000, windowDurationMins: 300 },
      },
      { rateLimitReachedType: "rate_limit_reached" },
    );

    expect(merged).toEqual({
      limitId: "codex",
      planType: "business",
      rateLimitReachedType: "rate_limit_reached",
      primary: { usedPercent: 100, resetsAt: 1_800_000_000, windowDurationMins: 300 },
    });
  });

  it("ignores a model-specific snapshot so it cannot replace the main allowance", () => {
    const main = {
      limitId: "codex",
      primary: { usedPercent: 100, resetsAt: 1_800_000_000, windowDurationMins: 300 },
    };
    expect(
      mergeCodexRateLimits(main, {
        limitId: "spark",
        primary: { usedPercent: 3, resetsAt: 1_800_000_000, windowDurationMins: 300 },
      }),
    ).toBe(main);
  });
});
