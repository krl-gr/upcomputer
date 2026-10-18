import { describe, expect, it } from "vite-plus/test";
import { RuntimeRequestId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { botStatus } from "./botStatus.ts";

describe("bot status", () => {
  const idle = {
    status: "idle",
    pendingRuntimeRequest: null,
    hasActionableProposedPlan: false,
  } as const;
  it("reserves limited for a recorded provider usage limit", () => {
    expect(botStatus({ ...idle, status: "failed", lastErrorClass: "usage_limit" }).state).toBe(
      "limited",
    );
    expect(botStatus({ ...idle, status: "failed", lastErrorClass: "provider_error" }).state).toBe(
      "attention",
    );
    expect(botStatus({ ...idle, status: "running", lastErrorClass: "usage_limit" }).state).toBe(
      "working",
    );
    expect(botStatus(null).state).toBe("idle");
  });
  it("separates queued and external waits from requests for a human", () => {
    expect(botStatus({ ...idle, status: "queued" }).state).toBe("waiting");
    expect(botStatus({ ...idle, status: "waiting" }).state).toBe("waiting");
    expect(
      botStatus({
        ...idle,
        status: "waiting",
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("permission"),
          kind: "permission",
          createdAt: DateTime.makeUnsafe("2026-10-18T00:00:00Z"),
        },
      }).state,
    ).toBe("attention");
    expect(botStatus({ ...idle, hasActionableProposedPlan: true }).state).toBe("attention");
  });
});
