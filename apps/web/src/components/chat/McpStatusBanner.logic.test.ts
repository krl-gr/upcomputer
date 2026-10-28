import { describe, expect, it } from "vite-plus/test";

import { mcpStatusNotices } from "./McpStatusBanner.logic";

describe("mcpStatusNotices", () => {
  it("says nothing while the t3-code server is attached and no user server failed", () => {
    expect(
      mcpStatusNotices(
        { t3: { outcome: "attached" }, userServerCount: 2, failedUserServers: [] },
        "Up.computer",
      ),
    ).toEqual({ t3: null, userServers: null });
    expect(mcpStatusNotices(null, "Up.computer")).toEqual({ t3: null, userServers: null });
  });

  it("explains a dropped connection and names failed user servers", () => {
    const notices = mcpStatusNotices(
      {
        t3: { outcome: "disconnected", reason: "connection_lost" },
        userServerCount: 3,
        failedUserServers: ["notes", "crm"],
      },
      "Up.computer",
    );
    expect(notices.t3?.title).toBe(
      "This agent can't use Up.computer tools right now (tasks, delegation)",
    );
    expect(notices.t3?.description).toContain("The connection dropped during this session.");
    expect(notices.userServers?.title).toBe('MCP servers "notes", "crm" are not available');
  });
});
