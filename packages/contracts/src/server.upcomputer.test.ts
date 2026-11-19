import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ServerProviders } from "./server.ts";

const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);

const snapshot = {
  instanceId: "opencode",
  driver: "opencode",
  enabled: true,
  installed: true,
  version: "1.14.19",
  status: "error",
  auth: { status: "unknown" },
  checkedAt: "2026-11-19T00:00:00.000Z",
  models: [],
};

describe("ServerProvider statusReason", () => {
  it("keeps the provider when a newer server sends a category this build does not know", () => {
    const [known, future] = decodeServerProviders([
      { ...snapshot, statusReason: "migration" },
      { ...snapshot, instanceId: "opencode_2", statusReason: "some-future-reason" },
    ]);

    expect(known?.statusReason).toBe("migration");
    expect(future?.instanceId).toBe("opencode_2");
    expect(future?.statusReason).toBeUndefined();
  });
});
